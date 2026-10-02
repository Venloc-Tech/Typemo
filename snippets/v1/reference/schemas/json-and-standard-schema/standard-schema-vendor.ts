class StandardSchema {
  static readonly vendor: "typemo";
  static of<Input = unknown, Output = Record<string, unknown>>(source: SchemaSource): StandardSchemaV1<Input, Output>;
  static issue(issue: SchemaIssue): StandardSchemaIssue;
  static isSchema(value: unknown): value is AnyStandardSchema;
  static require(schema: unknown, where: string): AnyStandardSchema;
  static validateRows(schema: AnyStandardSchema, rows: readonly unknown[], indexed: boolean, offset?: number): unknown[] | Promise<unknown[]>;
}
