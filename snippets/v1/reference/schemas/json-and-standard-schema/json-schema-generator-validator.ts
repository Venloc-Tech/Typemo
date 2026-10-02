class JsonSchemaGenerator {
  static generate(source: SchemaSource): BsonJsonSchema;
  static validator(source: SchemaSource): CollectionValidator;
}

type SchemaSource = SchemaInfo | { readonly schema: SchemaInfo };
