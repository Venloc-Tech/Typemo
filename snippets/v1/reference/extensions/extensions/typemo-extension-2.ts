interface TypemoExtension<N extends ExtensionName = ExtensionName> {
  readonly name: N;
  readonly validateProp?: (value: unknown, field: ExtensionFieldInfo) => void;
  readonly validateSchema?: (value: unknown, schema: ExtensionSchemaInfo) => void;
}
