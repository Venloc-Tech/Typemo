class PluginRegistry {
  readonly level: Exclude<PluginLevel, "model">;
  use<O>(plugin: SchemaPlugin<O>, ...options: OptionsArgs<O>): this;
  get list(): readonly PluginUse[];
}

interface PluginUse {
  readonly plugin: SchemaPlugin<unknown>;
  readonly options: unknown;
  readonly level: PluginLevel;
}
