import type { ClientSession } from "mongodb";
import { StrictModeError } from "../errors/strict-mode-error.ts";

/*
 * What may run concurrently on ONE session. Measured on MongoDB 9.0.0-rc0 and 8.3.11 with driver 7.6:
 * - in a transaction, operations started concurrently BEFORE the first one finished fail with
 *   ConflictingOperationInProgress (117) — every run, reads included;
 * - in a session without a transaction, concurrent retryable writes are sent with the SAME txnNumber:
 *   the server treats all but one as retries and acknowledges them WITHOUT writing (8 insertOne
 *   acknowledged, 1 stored) — silent data loss, every run; mixed reads and writes fail with 217/40608
 *   or lose writes; concurrent READS work (30/30 runs);
 * - the driver documents parallel operations in a transaction as undefined behaviour (sessions.ts).
 * So: in a transaction ONE operation is in flight; in an explicit session without a transaction
 * any number of READS may be in flight together, a WRITE only alone. Anything else is refused with a
 * clear error instead of being sent (Mongoose fixed the same class of bugs case by case).
 */

/**
 * How an operation uses its session: reads may share a session outside a transaction, writes may not.
 *
 * @example
 * ```ts
 * const access: SessionAccess = "read"; // a read may share its session outside a transaction
 * ```
 */
export type SessionAccess = "read" | "write";

/** The operations in flight on one session. */
interface InFlight {
  /** The operations in flight, in start order (the first names the conflict). */
  readonly operations: Map<object, { readonly operation: string; readonly access: SessionAccess }>;
}

const IN_FLIGHT = new WeakMap<ClientSession, InFlight>();

const RULE =
  "operations on one session must run one after another — await each one; only reads may overlap, and only outside a transaction (MongoDB does not support concurrent operations on a session)";

/** The in-flight tracking of explicit sessions. */
export class SessionGuard {
  /**
   * Marks the session busy for `operation`.
   *
   * @param session - The explicit session.
   * @param operation - The operation name, used in the error message.
   * @param access - Whether the operation only reads or writes.
   * @returns The function that releases the session.
   * @throws {StrictModeError} With rule `concurrent-session` when the operation may not overlap what is in
   *   flight: anything in a transaction, a write (or a read next to a write) outside one.
   */
  static enter(session: ClientSession, operation: string, access: SessionAccess = "write"): () => void {
    let state = IN_FLIGHT.get(session);
    if (state !== undefined && state.operations.size > 0) {
      const running = [...state.operations.values()];
      const allowed = !session.inTransaction() && access === "read" && running.every((op) => op.access === "read");
      if (!allowed) {
        const current = running[0]?.operation ?? "another operation";
        throw new StrictModeError(
          "concurrent-session",
          `${operation}: the session is in use by ${current}, which has not finished; ${RULE}`,
        );
      }
    }
    if (state === undefined) {
      state = { operations: new Map() };
      IN_FLIGHT.set(session, state);
    }
    const token = {};
    const operations = state.operations;
    operations.set(token, { operation, access });
    return () => {
      operations.delete(token);
    };
  }

  /**
   * Runs `fn` with the session marked busy (no-op without a session).
   *
   * @param session - The explicit session, if any.
   * @param operation - The operation name, used in the error message.
   * @param fn - The work to run.
   * @param access - Whether the operation only reads or writes.
   * @returns What `fn` resolves with.
   * @throws {StrictModeError} With rule `concurrent-session` (see {@link SessionGuard.enter}).
   */
  static async around<R>(
    session: ClientSession | undefined,
    operation: string,
    fn: () => Promise<R>,
    access: SessionAccess = "write",
  ): Promise<R> {
    if (session === undefined) return fn();
    const release = SessionGuard.enter(session, operation, access);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * @param session - The explicit session.
   * @returns `true` when an operation is in flight on the session.
   */
  static busy(session: ClientSession): boolean {
    return (IN_FLIGHT.get(session)?.operations.size ?? 0) > 0;
  }
}
