import { ConfigurationError } from "../../errors/configuration-error.ts";

/**
 * Detects mixing of the two decorator packages: a project uses one of them only. `experimentalDecorators`
 * is global, so a legacy decorator of the core applied under TC39 semantics (or the reverse) receives
 * arguments of the other shape. That is the detectable form of mixing, and it is reported as a
 * `ConfigurationError` instead of a bare `TypeError`.
 */
export class DecoratorGuard {
  /**
   * Tells a TC39 decorator context apart from a legacy decorator key.
   *
   * @param value - The second argument a decorator received.
   * @returns `true` when `value` is a TC39 decorator context (`{ kind, name, metadata, ... }`).
   */
  static isTc39Context(value: unknown): boolean {
    return typeof value === "object" && value !== null && "kind" in value && "metadata" in value;
  }

  /**
   * Refuses a TC39 context in a legacy decorator of the core.
   *
   * @param decorator - The decorator name used in the error text, for example `@Prop`.
   * @param key - The second argument the legacy decorator received.
   * @throws {ConfigurationError} When `key` is a TC39 decorator context.
   */
  static assertLegacy(decorator: string, key: unknown): void {
    if (DecoratorGuard.isTc39Context(key)) {
      throw new ConfigurationError(
        `${decorator} from "@venloc/typemo" is a legacy decorator, but it was applied as a TC39 decorator (experimentalDecorators is off). Use "@venloc/typemo-decorators" in a TC39 project; the two packages cannot be mixed`,
      );
    }
  }
}
