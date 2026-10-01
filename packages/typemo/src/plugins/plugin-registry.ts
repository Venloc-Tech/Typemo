import { ConfigurationError } from "../errors/configuration-error.ts";
import type { SchemaPlugin } from "../schema/metadata/metadata-types.ts";

/**
 * Where a plugin was registered.
 *
 * @example
 * ```ts
 * const level: PluginLevel = "global"; // Typemo.plugin(...); "connection" is client.plugin(...)
 * ```
 */
export type PluginLevel = "global" | "connection" | "model";

/**
 * One registration of a plugin.
 *
 * @example
 * ```ts
 * const audit: SchemaPlugin<unknown> = () => {};
 * const use: PluginUse = { plugin: audit, options: undefined, level: "global" };
 * ```
 */
export interface PluginUse {
  /** The registered plugin. */
  readonly plugin: SchemaPlugin<unknown>;
  /** The options given at registration. */
  readonly options: unknown;
  /** The level the plugin was registered at. */
  readonly level: PluginLevel;
}

/** Makes the options argument optional only when the options type accepts `undefined`. */
type OptionsArgs<O> = undefined extends O ? [options?: O] : [options: O];

/**
 * An ordered list of plugin registrations: the global registry (`PluginRegistry.global`, `Typemo.plugin()`)
 * and one per connection. Model-level plugins are `@Plugin` on the class. Plugins run at compile time on a
 * `MetadataBuilder` draft of the schema.
 *
 * A registry is sealed by the first SUCCESSFUL compile of a schema with it (the global one by any client's
 * first model, a connection's by its own), exactly like the extension registries: a plugin registered later
 * would silently miss the schemas compiled before it (Mongoose applies global plugins at `model()` time, so
 * late registration silently does nothing there), so it is a `ConfigurationError` instead. A failed compile
 * leaves the registry open.
 */
export class PluginRegistry {
  /** The global registry: plugins applied to every schema compiled after registration. */
  static readonly global = new PluginRegistry("global");

  /** The registrations, in registration order. */
  private readonly entries: PluginUse[] = [];
  /** What sealed the registry (the first compile), or `undefined` while it is open. */
  private sealedBy: string | undefined;

  /**
   * @param level - Which level this registry holds registrations for.
   */
  constructor(readonly level: Exclude<PluginLevel, "model">) {}

  /**
   * Registers a plugin with its options (typed by the plugin).
   *
   * @typeParam O - The options type of the plugin.
   * @param plugin - The plugin to register.
   * @param options - The plugin options.
   * @returns The registry, for chaining.
   * @throws {ConfigurationError} When the registry is sealed or the plugin is not `{ name, apply }`.
   */
  use<O>(plugin: SchemaPlugin<O>, ...options: OptionsArgs<O>): this {
    if (this.sealedBy !== undefined) {
      throw new ConfigurationError(
        `plugin "${plugin?.name}": the ${this.level} plugins are fixed once a schema is compiled (${this.sealedBy} was); register plugins before the first model`,
      );
    }
    if (typeof plugin?.apply !== "function" || typeof plugin.name !== "string" || plugin.name === "") {
      throw new ConfigurationError("a plugin is an object { name, apply(builder, options) }");
    }
    this.entries.push(
      Object.freeze({ plugin: plugin as SchemaPlugin<unknown>, options: options[0], level: this.level }),
    );
    return this;
  }

  /** The registrations, in order (a copy). */
  get list(): readonly PluginUse[] {
    return [...this.entries];
  }

  /**
   * Closes the registry: called by the compiler after a successful compile, no more registrations are accepted.
   *
   * @param by - What sealed it (used in the error message); only the first call counts.
   */
  seal(by: string): void {
    this.sealedBy ??= by;
  }

  /**
   * The plugins to apply, in a deterministic order: global → connection → model (base class first,
   * source order within a class). The same plugin registered twice is applied once, at its first
   * position; with different options, or two plugins sharing a name, it is a `ConfigurationError`.
   *
   * @param uses - All registrations that apply, in the order above.
   * @param where - Names the schema being compiled (used in error messages).
   * @returns The registrations to apply, without duplicates.
   * @throws {ConfigurationError} On two different plugins with one name, or one plugin with different options.
   */
  static resolve(uses: readonly PluginUse[], where: string): readonly PluginUse[] {
    const byName = new Map<string, PluginUse>();
    const out: PluginUse[] = [];
    for (const use of uses) {
      const previous = byName.get(use.plugin.name);
      if (previous === undefined) {
        byName.set(use.plugin.name, use);
        out.push(use);
        continue;
      }
      if (previous.plugin !== use.plugin) {
        throw new ConfigurationError(`${where}: two different plugins are named "${use.plugin.name}"`);
      }
      if (!PluginRegistry.sameOptions(previous.options, use.options)) {
        throw new ConfigurationError(
          `${where}: plugin "${use.plugin.name}" is registered twice (${previous.level} and ${use.level}) with different options`,
        );
      }
    }
    return out;
  }

  /**
   * Compares plugin options by identity, then by JSON form.
   *
   * @param a - The first options value.
   * @param b - The second options value.
   * @returns `true` when both are the same value or serialize identically.
   */
  private static sameOptions(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
}
