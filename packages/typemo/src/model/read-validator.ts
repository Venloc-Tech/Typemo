import { BsonGuards } from "../bson/bson-guards.ts";
import { type BsonTypeKey, BsonTypeTable } from "../bson/bson-type-table.ts";
import { CastError } from "../errors/cast-error.ts";
import { SENSITIVE_MASK, SensitiveMask } from "../policies/sensitive-mask.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode, ScalarType } from "../schema/compiler/path-node.ts";

/*
 * Strict reading (the `validateReads` option, off by default): a stored document is checked against the schema
 * before it becomes a result. The driver returns whatever the collection holds — a document written by another
 * program, by the raw driver or by an older version of the schema can carry a value of another type, and without the
 * check it would reach the code under the declared type. The check runs on the driver's row, so every result form
 * (hydrated, lean, plain, cursor) is covered by one walk.
 *
 * Only what is present is checked: a projection leaves fields out, so an absent field is not an error; a key the
 * schema does not know (a computed projection, a text score) is not checked either.
 */

/** The row kinds of the type table each scalar type accepts as a stored value. */
const ACCEPTED: { readonly [K in ScalarType]: readonly BsonTypeKey[] } = {
  string: ["string"],
  number: ["int32", "double"],
  double: ["int32", "double"],
  int32: ["int32"],
  long: ["long"],
  decimal128: ["decimal128"],
  boolean: ["bool"],
  date: ["date"],
  objectId: ["objectId"],
  uuid: ["uuid"],
  binary: ["binary", "uuid", "vector"],
  vector: ["vector"],
  regex: ["regex"],
  timestamp: ["timestamp"],
};

/** The names of the scalar types in the vocabulary of the casters' errors. */
const EXPECTED: { readonly [K in ScalarType]: string } = {
  string: "string",
  number: "number",
  double: "Double",
  int32: "Int32",
  long: "Long",
  decimal128: "Decimal128",
  boolean: "boolean",
  date: "Date",
  objectId: "ObjectId",
  uuid: "UUID",
  binary: "Binary",
  vector: "Vector",
  regex: "RegExp",
  timestamp: "Timestamp",
};

const join = (path: string, key: string | number): string => (path === "" ? String(key) : `${path}.${key}`);

/** The check of stored documents against their schema. */
export class ReadValidator {
  /**
   * Checks one stored document (as the driver returned it) against its schema.
   *
   * @param schema - The schema of the collection's root model (a discriminated document is checked by its class).
   * @param raw - The stored document.
   * @throws {CastError} With reason `type` (a value of another type) or `null` (a `null` on a path that is not
   *   nullable) and the path of the value, array indexes and Map keys included.
   */
  static check(schema: CompiledSchema, raw: Readonly<Record<string, unknown>>): void {
    ReadValidator.document(schema, raw, "", schema.name);
  }

  /**
   * Checks a document (root, subdocument or nested object) field by field.
   *
   * @param declared - The schema that describes it.
   * @param raw - The stored document.
   * @param path - Its path in code names.
   * @param model - The class name of the root, for the message.
   */
  private static document(
    declared: CompiledSchema,
    raw: Readonly<Record<string, unknown>>,
    path: string,
    model: string,
  ): void {
    const schema =
      declared.discriminators.size === 0
        ? declared
        : (declared.root.discriminatorFor(raw[declared.discriminatorKey]) ?? declared);
    for (const node of schema.fields) {
      if (!Object.hasOwn(raw, node.dbKey)) continue;
      ReadValidator.value(node, raw[node.dbKey], join(path, node.key), model);
    }
  }

  /**
   * Checks one stored value by its node.
   *
   * @param node - The schema node.
   * @param stored - The stored value.
   * @param path - The path of the value.
   * @param model - The class name of the root, for the message.
   */
  private static value(node: PathNode, stored: unknown, path: string, model: string): void {
    if (stored === undefined) return;
    if (stored === null) {
      if (!node.nullable) ReadValidator.fail(node, stored, path, model, "null", "the path is not nullable");
      return;
    }
    switch (node.kind) {
      case "array":
        if (!Array.isArray(stored)) ReadValidator.mismatch(node, stored, path, model);
        stored.forEach((item: unknown, index) => {
          ReadValidator.value(node.element, item, join(path, index), model);
        });
        return;
      case "map":
        if (!BsonGuards.isPlainObject(stored)) ReadValidator.mismatch(node, stored, path, model);
        for (const [key, item] of Object.entries(stored)) ReadValidator.value(node.value, item, join(path, key), model);
        return;
      case "subdocument":
      case "nested":
        if (!BsonGuards.isPlainObject(stored)) ReadValidator.mismatch(node, stored, path, model);
        ReadValidator.document(node.schema, stored, path, model);
        return;
      case "scalar":
        if (!ACCEPTED[node.type].includes(ReadValidator.kindOf(stored) as BsonTypeKey))
          ReadValidator.mismatch(node, stored, path, model);
        return;
      case "union": {
        const kind = ReadValidator.kindOf(stored);
        if (!node.members.some((member) => ACCEPTED[member].includes(kind as BsonTypeKey)))
          ReadValidator.mismatch(node, stored, path, model);
        return;
      }
    }
  }

  /**
   * The type-table row of a stored value; the driver's `Int32`/`Double` wrappers count as numbers.
   *
   * @param stored - The stored value.
   * @returns The row key, `undefined` for a value outside the table.
   */
  private static kindOf(stored: unknown): BsonTypeKey | undefined {
    return BsonTypeTable.kindOf(BsonGuards.isInt32(stored) || BsonGuards.isDouble(stored) ? stored.valueOf() : stored);
  }

  /**
   * The expected type of a node in the casters' vocabulary.
   *
   * @param node - The schema node.
   * @returns `string`, `Int32`, `Array`, `Map`, the class name of a subdocument, a union `string | number`.
   */
  private static expected(node: PathNode): string {
    switch (node.kind) {
      case "scalar":
        return EXPECTED[node.type];
      case "union":
        return node.members.map((member) => EXPECTED[member]).join(" | ");
      case "array":
        return "Array";
      case "map":
        return "Map";
      case "subdocument":
      case "nested":
        return node.schema.name;
    }
  }

  /**
   * Throws the error of a value of another type.
   *
   * @param node - The schema node.
   * @param stored - The stored value.
   * @param path - The path of the value.
   * @param model - The class name of the root.
   * @throws {CastError} Always, reason `type`.
   */
  private static mismatch(node: PathNode, stored: unknown, path: string, model: string): never {
    return ReadValidator.fail(node, stored, path, model, "type", "the stored value does not match the schema");
  }

  /**
   * Throws the `CastError` of a stored value; a `sensitive` or `Hidden` field shows its value masked.
   *
   * @param node - The schema node.
   * @param stored - The stored value.
   * @param path - The path of the value.
   * @param model - The class name of the root.
   * @param reason - `type` or `null`.
   * @param what - The first half of the explanation.
   * @throws {CastError} Always.
   */
  private static fail(
    node: PathNode,
    stored: unknown,
    path: string,
    model: string,
    reason: "type" | "null",
    what: string,
  ): never {
    const sensitive = node.options.sensitive;
    const shown =
      sensitive !== undefined && sensitive !== "show"
        ? SensitiveMask.forError(sensitive, stored, path, undefined, node)
        : node.hidden
          ? SENSITIVE_MASK
          : stored;
    throw new CastError({
      path,
      value: shown,
      expected: ReadValidator.expected(node),
      reason,
      detail: `${what} of ${model} (a document read from the database, checked by validateReads)`,
    });
  }
}
