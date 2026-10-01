import type { ClientSession } from "mongodb";
import { ConfigurationError } from "../errors/configuration-error.ts";
import type { ExtensionRegistry } from "../schema/extensions/extension-registry.ts";
import type { TransactionOptions } from "./transaction-scope.ts";
import type { TransactionCallback, TypemoClient } from "./typemo-client.ts";

/*
 * The members of `TypemoClient` that only the core calls (the extension registry, the pipeline's wait, the
 * audited transaction) live in `#private` members: a tag in a comment is not a wall, because users read the
 * declaration files of a package. The client installs these accessors from a static block; this class is
 * exported from `src/internal.ts` and never from the public entry `src/index.ts`.
 */

/**
 * How `TypemoClient` exposes its core-only members (installed once by `TypemoClient`).
 *
 * @example
 * ```ts
 * ClientInternals.install({
 *   extensions: (client) => client.#extensions,
 *   readyIfNeeded: (client, timeoutMS) => client.#readyIfNeeded(timeoutMS),
 *   linksDriverCommands: (client) => client.#driverListeners.commands,
 *   auditTransaction: (client, label, fn, session, options) => client.#auditTransaction(label, fn, session, options),
 * });
 * ```
 */
export interface ClientAccess {
  /** Reads the schema extension registry of a client. */
  readonly extensions: (client: TypemoClient) => ExtensionRegistry;
  /** The operation pipeline's wait. */
  readonly readyIfNeeded: (client: TypemoClient, timeoutMS: number | undefined) => Promise<void> | undefined;
  /** Whether the executor should link driver commands to operations (a subscriber wants them). */
  readonly linksDriverCommands: (client: TypemoClient) => boolean;
  /** An audited write outside a transaction, in its own transaction. */
  readonly auditTransaction: <R>(
    client: TypemoClient,
    label: string,
    fn: TransactionCallback<R>,
    session: ClientSession | undefined,
    options: TransactionOptions,
  ) => Promise<R>;
}

/** Internal access to the core-only members of a client. Not part of the public API. */
export class ClientInternals {
  static #access: ClientAccess | undefined;

  /**
   * Installs the accessors. Called once by `TypemoClient`'s static block; later calls are ignored.
   *
   * @param access - The accessors to the client's private members.
   */
  static install(access: ClientAccess): void {
    ClientInternals.#access ??= access;
  }

  /**
   * @returns The installed accessors.
   * @throws {ConfigurationError} When `TypemoClient` has not been loaded yet.
   */
  static #required(): ClientAccess {
    const access = ClientInternals.#access;
    if (access === undefined) throw new ConfigurationError("ClientInternals: TypemoClient is not loaded");
    return access;
  }

  /**
   * @param client - The client.
   * @returns The schema extensions of the client's models (over the global ones).
   */
  static extensions(client: TypemoClient): ExtensionRegistry {
    return ClientInternals.#required().extensions(client);
  }

  /**
   * @param client - The client.
   * @param timeoutMS - The operation's own `timeoutMS`, if any.
   * @returns `undefined` when the client is ready already (no promise, no tick), else the promise to wait for.
   */
  static readyIfNeeded(client: TypemoClient, timeoutMS: number | undefined): Promise<void> | undefined {
    return ClientInternals.#required().readyIfNeeded(client, timeoutMS);
  }

  /**
   * @param client - The client.
   * @returns `true` when a subscriber wants the driver's commands linked to operations.
   */
  static linksDriverCommands(client: TypemoClient): boolean {
    return ClientInternals.#required().linksDriverCommands(client);
  }

  /**
   * Runs an audited write that is outside a transaction in its own transaction, so that the write and its
   * audit entry commit together.
   *
   * @param client - The client.
   * @param label - The operation name, used in the error message.
   * @param fn - The callback that performs the write.
   * @param session - The operation's explicit session, if any.
   * @param options - Transaction options.
   * @returns What the callback returns.
   */
  static auditTransaction<R>(
    client: TypemoClient,
    label: string,
    fn: TransactionCallback<R>,
    session: ClientSession | undefined,
    options: TransactionOptions,
  ): Promise<R> {
    return ClientInternals.#required().auditTransaction(client, label, fn, session, options);
  }
}
