/*
 * The public API of the connection layer, re-exported by `src/index.ts` in one line. `SessionGuard` and
 * `TransactionContext` are internal (`src/internal.ts`).
 */
export type {
  LegacyTimeoutOption,
  ResolvedClientOptions,
  TypemoClientOptions,
  TypemoOwnOptions,
} from "./client-options.ts";
export { Connection } from "./connection.ts";
export type { ConnectionState } from "./connection-state.ts";
export type { SessionAccess } from "./session-guard.ts";
export { type TransactionOptions, type TransactionParticipant, TransactionScope } from "./transaction-scope.ts";
export { type TransactionCallback, TypemoClient } from "./typemo-client.ts";
