import { AsyncLocalStorage } from "node:async_hooks";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";

/**
 * What a command listener knows of the operation: its id, its schema (used to mask the commands of `sensitive`
 * fields) and the address of its last command (so `operation.end` can report the real server).
 */
export class OperationLink {
  /** `host:port` of the last command the operation sent (set by the command listener). */
  address: string | undefined = undefined;

  /**
   * @param id - The operation id.
   * @param schema - The compiled schema of the operation's model.
   */
  constructor(
    readonly id: number,
    readonly schema: CompiledSchema,
  ) {}
}

const STORE = new AsyncLocalStorage<OperationLink>();

/**
 * Links driver command events to the Typemo operation that issued them.
 *
 * The executor runs the driver call inside {@link OperationScope.run}, only when a subscriber asked for driver
 * commands, and the command listener reads the link back. The driver emits `commandStarted` synchronously inside
 * the async chain of the call, so the store always holds the issuing operation.
 */
export class OperationScope {
  /** `ctx.locals` key of the operation's {@link OperationLink}. */
  static readonly LINK: symbol = Symbol("typemo.operation.link");

  /**
   * Runs a function with a link as the current operation.
   *
   * @param link - The link to expose through {@link OperationScope.current}.
   * @param fn - The function to run.
   * @returns The result of `fn`.
   */
  static run<R>(link: OperationLink, fn: () => R): R {
    return STORE.run(link, fn);
  }

  /**
   * The Typemo operation in the current async context.
   *
   * @returns The link, or `undefined` outside an operation scope.
   */
  static current(): OperationLink | undefined {
    return STORE.getStore();
  }
}
