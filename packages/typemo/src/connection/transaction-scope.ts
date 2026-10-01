import type { ClientSession } from "mongodb";
import { TransactionContext } from "./transaction-context.ts";

/*
 * The per-transaction registry of participants. The driver's `withTransaction` retries the WHOLE callback on
 * `TransientTransactionError` (and on a transient commit error). Anything the callback changed in memory
 * during the failed attempt is then wrong: a document that believes it was inserted (`isNew: false`, a bumped
 * version, cleared modified paths, consumed array atomics) would make the retried `save()` send an update
 * instead of the insert, or skip changes (a known Mongoose trap). A participant (a document) enlists in
 * the scope before it changes such state, snapshots it, and restores it in `onRetry`.
 */

/**
 * Something that keeps in-memory state tied to a transaction's outcome (a document).
 *
 * @example
 * ```ts
 * declare const scope: TransactionScope;
 * const participant: TransactionParticipant = {
 *   onRetry: () => console.log("restore the state from before the transaction"),
 *   onAbort: () => console.log("restore the state from before the transaction"),
 *   onCommit: () => console.log("drop the snapshot"),
 * };
 * scope.enlist(participant);
 * ```
 */
export interface TransactionParticipant {
  /** The attempt failed and the callback runs again: restore the state from before the transaction. */
  readonly onRetry?: () => void | Promise<void>;
  /** The transaction failed for good: restore the state from before the transaction. */
  readonly onAbort?: () => void | Promise<void>;
  /** The transaction committed: the state of the last attempt is now the truth. */
  readonly onCommit?: () => void | Promise<void>;
}

/**
 * Options of `connection.transaction()` (the driver's `TransactionOptions`, in plain forms).
 *
 * @example
 * ```ts
 * const options: TransactionOptions = { readConcern: "snapshot", writeConcern: { w: "majority" }, timeoutMS: 5_000 };
 * await connection.transaction(async () => {}, options);
 * ```
 */
export interface TransactionOptions {
  /** The read concern level of the transaction. */
  readonly readConcern?: "local" | "majority" | "snapshot";
  /** The write concern of the commit. */
  readonly writeConcern?: { readonly w?: number | "majority"; readonly journal?: boolean };
  /** Deadline for the whole transaction, retries included (driver CSOT). */
  readonly timeoutMS?: number;
  /** The maximum time the server may spend committing. */
  readonly maxCommitTimeMS?: number;
}

let NEXT_TRANSACTION_ID = 0;

/**
 * One `connection.transaction()` call: its session, the current attempt and the participants of that
 * attempt. Handed to the callback and carried to every operation inside it by `AsyncLocalStorage`.
 */
export class TransactionScope {
  /** A process-wide sequence number of the transaction. */
  readonly id: number;
  /** The driver session the transaction runs on. */
  readonly session: ClientSession;
  /** The client that owns the session (operations of another client do not join the transaction). */
  readonly owner: object;
  /** The transaction's `timeoutMS` (operations inside must not set their own: driver rule). */
  readonly timeoutMS: number | undefined;
  /** When the transaction started (`performance.now()`, milliseconds). */
  readonly startedAt = performance.now();
  #attempt = 0;
  #participants: TransactionParticipant[] = [];

  /**
   * Creates the scope and registers it under its session.
   *
   * @param session - The driver session of the transaction.
   * @param owner - The client that owns the session.
   * @param timeoutMS - The transaction's `timeoutMS`, if any.
   */
  constructor(session: ClientSession, owner: object, timeoutMS: number | undefined) {
    this.id = ++NEXT_TRANSACTION_ID;
    this.session = session;
    this.owner = owner;
    this.timeoutMS = timeoutMS;
    TransactionContext.register(this);
  }

  /**
   * The transaction of the current async context, of whatever client: `undefined` outside every `transaction()`.
   * Read-only: it tells where the caller runs (its `owner` is the client), it does not start or join anything. For
   * the question "am I inside a transaction of THIS client", use `client.currentTransaction()`.
   *
   * @returns The ambient transaction, or `undefined`.
   * @example
   * ```ts
   * const scope = TransactionScope.current();
   * if (scope !== undefined) console.log(`attempt ${scope.attempt} of transaction ${scope.id}`);
   * ```
   */
  static current(): TransactionScope | undefined {
    return TransactionContext.current();
  }

  /** 1 for the first run of the callback, 2 for the first retry, … */
  get attempt(): number {
    return this.#attempt;
  }

  /** The participants of the current attempt. */
  get participants(): readonly TransactionParticipant[] {
    return this.#participants;
  }

  /**
   * Adds a participant to the current attempt (once: enlisting twice is a no-op).
   *
   * @param participant - The participant to notify about the outcome.
   */
  enlist(participant: TransactionParticipant): void {
    if (!this.#participants.includes(participant)) this.#participants = [...this.#participants, participant];
  }

  /**
   * @internal Called before each run of the callback: rolls back the previous attempt's participants.
   * @throws {unknown} The first failure of a participant's `onRetry`.
   */
  async beginAttempt(): Promise<void> {
    this.#attempt++;
    if (this.#attempt > 1) await this.#notify("onRetry");
  }

  /**
   * @internal The transaction committed.
   * @throws {unknown} The first failure of a participant's `onCommit`.
   */
  async committed(): Promise<void> {
    await this.#notify("onCommit");
  }

  /**
   * @internal The transaction failed for good.
   * @throws {unknown} The first failure of a participant's `onAbort`.
   */
  async aborted(): Promise<void> {
    await this.#notify("onAbort");
  }

  /**
   * Notifies the participants and forgets them. Every participant is notified even if one throws (a failed
   * rollback of one document must not leave the others unrolled); the first failure is rethrown afterwards.
   *
   * @param event - The participant callback to call.
   * @throws {unknown} The first failure thrown by a participant.
   */
  async #notify(event: "onRetry" | "onAbort" | "onCommit"): Promise<void> {
    const participants = this.#participants;
    this.#participants = [];
    const failures: unknown[] = [];
    for (const participant of participants) {
      try {
        await participant[event]?.();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }
}
