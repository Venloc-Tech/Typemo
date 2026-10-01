import type { TransactionParticipant } from "../connection/transaction-scope.ts";
import { type CollectionSnapshot, Collections } from "./collections/collections.ts";
import type { FieldBaseline } from "./collections/field-baseline.ts";
import { type DocumentState, DocumentStates } from "./document-state.ts";

/**
 * A document as a bag of fields.
 *
 * @example
 * ```ts
 * const doc: Doc = { name: "Ada" };
 * ```
 */
type Doc = Record<string, unknown>;

/**
 * The full in-memory state of one document, for the rollback between transaction attempts (Mongoose H307,
 * H204, H018). `withTransaction` re-runs the whole callback after a `TransientTransactionError`; a document
 * saved in the failed attempt must be exactly as before that save: `isNew`, the version, the baseline (so the
 * changes are changes again), the forced paths, the values of its fields, and the journals of its collections.
 *
 * @example
 * ```ts
 * const snapshot = DocumentSnapshots.take(user);
 * DocumentSnapshots.restore(user, snapshot);
 * ```
 */
export interface DocumentSnapshot {
  /** Whether the document had not been inserted yet. */
  readonly isNew: boolean;
  /** Whether the document had been deleted. */
  readonly deleted: boolean;
  /** The version the document was loaded or last saved with. */
  readonly version: number | undefined;
  /** The change-tracking baseline. */
  readonly baseline: FieldBaseline;
  /** The known cast values of scalar fields. */
  readonly cast: ReadonlyMap<string, unknown> | undefined;
  /** The paths forced into the next update. */
  readonly marked: ReadonlySet<string> | undefined;
  /** Own values of the schema fields (absent ones are not listed). */
  readonly values: ReadonlyMap<string, unknown>;
  /** The snapshots of the tracked collections by field key. */
  readonly collections: ReadonlyMap<string, CollectionSnapshot>;
}

/** Snapshots and the transaction participant of documents. */
export class DocumentSnapshots {
  /**
   * Captures the state of a document.
   *
   * @param document - A hydrated root document.
   * @returns The snapshot.
   * @throws {InternalError} When the value is not a hydrated document.
   */
  static take(document: object): DocumentSnapshot {
    const state = DocumentStates.of(document);
    const doc = document as Doc;
    const values = new Map<string, unknown>();
    const collections = new Map<string, CollectionSnapshot>();
    for (const node of state.schema.fields) {
      if (!Object.hasOwn(doc, node.key)) continue;
      const value = doc[node.key];
      values.set(node.key, value);
      if (Collections.isTracked(value)) collections.set(node.key, Collections.snapshot(value));
    }
    return {
      isNew: state.isNew,
      deleted: state.deleted,
      version: state.version,
      baseline: state.baseline.copy(),
      cast: state.cast === undefined ? undefined : new Map(state.cast),
      marked: state.marked === undefined ? undefined : new Set(state.marked),
      values,
      collections,
    };
  }

  /**
   * Puts a document back into a captured state.
   *
   * @param document - The hydrated root document.
   * @param snapshot - The snapshot taken from it earlier.
   * @throws {InternalError} When the value is not a hydrated document.
   */
  static restore(document: object, snapshot: DocumentSnapshot): void {
    const state: DocumentState = DocumentStates.of(document);
    const doc = document as Doc;
    for (const node of state.schema.fields) {
      if (snapshot.values.has(node.key)) {
        Object.defineProperty(doc, node.key, {
          value: snapshot.values.get(node.key),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else if (Object.hasOwn(doc, node.key)) {
        delete doc[node.key];
      }
    }
    for (const [key, saved] of snapshot.collections) Collections.restore(doc[key], saved);
    state.isNew = snapshot.isNew;
    state.deleted = snapshot.deleted;
    state.version = snapshot.version;
    state.baseline = snapshot.baseline.copy();
    state.cast = snapshot.cast === undefined ? undefined : new Map(snapshot.cast);
    state.marked = snapshot.marked === undefined ? undefined : new Set(snapshot.marked);
  }

  /**
   * The participant of a document in a transaction attempt: the state from before its first save in the
   * attempt comes back on retry and on abort; on commit nothing changes (the saved state is the truth).
   *
   * @param document - The hydrated root document.
   * @param snapshot - The state from before its first save in the attempt.
   * @returns The transaction participant.
   */
  static participant(document: object, snapshot: DocumentSnapshot): TransactionParticipant {
    return {
      onRetry: () => DocumentSnapshots.restore(document, snapshot),
      onAbort: () => DocumentSnapshots.restore(document, snapshot),
    };
  }
}
