interface ExtensionSchemaInfo {
  readonly name: string;
  readonly kind: "document" | "nested";
  readonly discriminator: string | undefined;
}
