import type { Db, MongoClient } from "mongodb";

/**
 * Settings of the `failCommand` fail point.
 *
 * @example
 * ```ts
 * const options: FailCommandOptions = { failCommands: ["insert"], errorCode: 112, times: 1 };
 * ```
 */
export interface FailCommandOptions {
  /** Command names to fail, e.g. `["insert", "find"]`. */
  readonly failCommands: readonly string[];
  /** Numeric server error code to return, e.g. `112` (WriteConflict). */
  readonly errorCode?: number;
  /** Error labels to attach, e.g. `["TransientTransactionError"]`. */
  readonly errorLabels?: readonly string[];
  /** Close the connection instead of returning a normal error response. */
  readonly closeConnection?: boolean;
  /** Block the connection for `blockTimeMS` before responding — used to simulate timeouts. */
  readonly blockConnection?: boolean;
  /** How long to block, in milliseconds. */
  readonly blockTimeMS?: number;
  /** Only fail the next `times` matching commands. Defaults to `alwaysOn`. */
  readonly times?: number;
}

/**
 * Handle of an enabled fail point.
 *
 * @example
 * ```ts
 * const handle: FailPointHandle = await FailPointHelpers.configureFailCommand(client, options);
 * await handle.disable();
 * ```
 */
export interface FailPointHandle {
  /**
   * Turns the failpoint back off. Always call this, even on the failure path of a test.
   *
   * @returns Resolves when the fail point is off; a repeated call does nothing.
   */
  disable(): Promise<void>;
}

/**
 * Wrapper around the `failCommand` fail point. Requires the
 * server to have been started with `--setParameter enableTestCommands=1` —
 * `MongoHarness` does this. Without it, `configureFailPoint` itself fails
 * with `CommandNotSupported` / `40324` (unrecognized parameter / unknown
 * command), which is a useful diagnostic if this ever regresses.
 */
export class FailPointHelpers {
  /**
   * Enables `failCommand` on the server.
   *
   * @param client - Connected client.
   * @param options - Which commands fail and how.
   * @returns A handle that turns the fail point off.
   * @throws MongoServerError - When the server has test commands disabled.
   */
  static async configureFailCommand(client: MongoClient, options: FailCommandOptions): Promise<FailPointHandle> {
    const admin: Db = client.db("admin");
    const data: Record<string, unknown> = { failCommands: [...options.failCommands] };
    if (options.errorCode !== undefined) {
      data.errorCode = options.errorCode;
    }
    if (options.errorLabels) {
      data.errorLabels = [...options.errorLabels];
    }
    if (options.closeConnection !== undefined) {
      data.closeConnection = options.closeConnection;
    }
    if (options.blockConnection !== undefined) {
      data.blockConnection = options.blockConnection;
    }
    if (options.blockTimeMS !== undefined) {
      data.blockTimeMS = options.blockTimeMS;
    }

    await admin.command({
      configureFailPoint: "failCommand",
      mode: options.times !== undefined ? { times: options.times } : "alwaysOn",
      data,
    });

    let disabled = false;
    return {
      disable: async (): Promise<void> => {
        if (disabled) {
          return;
        }
        disabled = true;
        await admin.command({ configureFailPoint: "failCommand", mode: "off" });
      },
    };
  }
}
