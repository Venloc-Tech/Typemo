import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession } from "mongodb";
import type { TransactionScope } from "./transaction-scope.ts";

/*
 * The ambient transaction: every operation inside `connection.transaction(fn)` finds the session here,
 * including populate, cursors, aggregations, bulk writes and inserts — no `session` argument to pass around
 * (in Mongoose, forgetting it on one path silently ran that operation outside the transaction).
 */

const STORE = new AsyncLocalStorage<TransactionScope>();
/** The `transaction()` of a session, for an operation given that session explicitly (outside the ambient context). */
const BY_SESSION = new WeakMap<ClientSession, TransactionScope>();

/** The transaction of the current async context. */
export class TransactionContext {
  /**
   * Runs `fn` with `scope` as the ambient transaction.
   *
   * @param scope - The transaction to make ambient.
   * @param fn - The function to run.
   * @returns What `fn` returns.
   */
  static run<R>(scope: TransactionScope, fn: () => R): R {
    return STORE.run(scope, fn);
  }

  /**
   * @returns The ambient transaction, `undefined` outside `transaction()`.
   */
  static current(): TransactionScope | undefined {
    return STORE.getStore();
  }

  /**
   * Remembers the `transaction()` of its session (a scope registers itself when created), so an operation
   * given that session explicitly still joins the scope.
   *
   * @param scope - The scope to register.
   */
  static register(scope: TransactionScope): void {
    BY_SESSION.set(scope.session, scope);
  }

  /**
   * @param session - A driver session.
   * @returns The `transaction()` whose session this is, `undefined` for any other session.
   */
  static ofSession(session: ClientSession): TransactionScope | undefined {
    return BY_SESSION.get(session);
  }
}
