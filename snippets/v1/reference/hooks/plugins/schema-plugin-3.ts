interface SchemaPlugin<O = undefined, S extends object = Record<never, never>> {
  readonly name: string;
  apply(builder: PluginBuilder, options: O): void;
  readonly statics?: S;
}
