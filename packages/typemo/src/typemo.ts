import {
  InstrumentationHub,
  type InstrumentationSubscriber,
  type Subscription,
} from "./instrumentation/instrumentation-hub.ts";
import { PluginRegistry } from "./plugins/plugin-registry.ts";
import { ExtensionRegistry, type TypemoExtension } from "./schema/extensions/extension-registry.ts";
import type { SchemaPlugin } from "./schema/metadata/metadata-types.ts";

/** Makes the options argument optional only when the options type accepts `undefined`. */
type OptionsArgs<O> = undefined extends O ? [options?: O] : [options: O];

/**
 * Process-wide settings of Typemo: global plugins, schema extensions and instrumentation subscribers.
 * Clients and connections are explicit (`TypemoClient`): there is no global connection.
 */
export class Typemo {
  /**
   * Registers a global plugin: applied to every schema compiled afterwards, before the connection and model
   * plugins.
   *
   * @typeParam O - The options type of the plugin.
   * @param plugin - The plugin to register.
   * @param options - The plugin options (required when the plugin declares non-optional options).
   * @throws {ConfigurationError} When a schema was already compiled successfully (a failed compile leaves the
   * list open), or the plugin is malformed.
   */
  static plugin<O>(plugin: SchemaPlugin<O>, ...options: OptionsArgs<O>): void {
    PluginRegistry.global.use(plugin, ...options);
  }

  /**
   * Registers a schema extension for EVERY client (`client.use()` registers one for a single client): its key
   * becomes valid in `ext` of `@Prop`/`@Schema`, and its validators check every value at compile time.
   * Like `Typemo.plugin`, it must come before the first model: the first successful schema compile (on any
   * client, or without one) fixes the global list; a failed compile leaves it open.
   *
   * @param extension - The extension to register.
   * @throws {ConfigurationError} When a schema was already compiled, the extension is malformed, or an
   * extension with the same name is already registered.
   */
  static use(extension: TypemoExtension): void {
    ExtensionRegistry.global.use(extension);
  }

  /**
   * Registers an instrumentation subscriber for the operations of EVERY client (`client.instrument` registers
   * one for a single client). Without subscribers instrumentation costs nothing.
   *
   * @param subscriber - The subscriber to notify about operations.
   * @returns A subscription; call its unsubscribe method to stop receiving events.
   */
  static instrument(subscriber: InstrumentationSubscriber): Subscription {
    return InstrumentationHub.global.subscribe(subscriber);
  }
}
