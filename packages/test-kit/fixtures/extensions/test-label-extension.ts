/*
 * A test-only schema extension: no real integration, just the mechanism. Importing this
 * file augments `PropExtensions`/`SchemaExtensions` with the key `testLabel` for the whole test program.
 */
import type { ExtensionFieldInfo, ExtensionSchemaInfo, TypemoExtension } from "@venloc/typemo";

/**
 * Field options of the test extension: a label and an optional sample typed by the field value.
 *
 * @example
 * ```ts
 * const options: TestLabelPropOptions<number> = { label: "Age", sample: (value) => String(value) };
 * ```
 */
export interface TestLabelPropOptions<V> {
  /** Non-empty label. */
  readonly label: string;
  /** Renders a sample of the field value. */
  readonly sample?: (value: V) => string;
}

/**
 * Schema options of the test extension.
 *
 * @example
 * ```ts
 * const options: TestLabelSchemaOptions = { group: "people" };
 * ```
 */
export interface TestLabelSchemaOptions {
  /** The group name. */
  readonly group: string;
}

declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    testLabel?: TestLabelPropOptions<V>;
  }
  interface SchemaExtensions {
    testLabel?: TestLabelSchemaOptions;
  }
}

/**
 * Narrows a value to a plain, non-array object.
 *
 * @param value - Any value.
 * @returns `true` for a non-null, non-array object.
 */
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What the validators saw, for assertions. */
export const testLabelSeen: string[] = [];

/** The test extension: it validates its options and records what it saw. */
export const testLabelExtension: TypemoExtension<"testLabel"> = {
  name: "testLabel",
  validateProp: (value: unknown, field: ExtensionFieldInfo): void => {
    if (!isObject(value) || typeof value.label !== "string" || value.label === "") {
      throw new TypeError("testLabel: { label: non-empty string } expected");
    }
    if (value.sample !== undefined && typeof value.sample !== "function") {
      throw new TypeError("testLabel: sample must be a function");
    }
    testLabelSeen.push(`prop ${field.where} ${field.path}->${field.dbPath} ${field.kind}`);
  },
  validateSchema: (value: unknown, schema: ExtensionSchemaInfo): void => {
    if (!isObject(value) || typeof value.group !== "string")
      throw new TypeError("testLabel: { group: string } expected");
    testLabelSeen.push(`schema ${schema.name} ${schema.kind} ${schema.discriminator ?? "-"}`);
  },
};
