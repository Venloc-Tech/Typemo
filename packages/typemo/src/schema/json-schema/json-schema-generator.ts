import type { CompiledSchema } from "../compiler/compiled-schema.ts";
import type { PathNode, ScalarType } from "../compiler/path-node.ts";
import { type SchemaSource, SchemaSources } from "../compiler/schema-source.ts";

/**
 * A MongoDB `$jsonSchema` node (the subset the server supports: `bsonType`, no `type`).
 *
 * @example
 * ```ts
 * const node: BsonJsonSchema = { bsonType: "object", properties: { name: { bsonType: "string" } } };
 * ```
 */
export interface BsonJsonSchema {
  /** The BSON type or types the value may have. */
  bsonType?: string | string[];
  /** The schemas of an object's fields. */
  properties?: Record<string, BsonJsonSchema>;
  /** The fields an object must have. */
  required?: string[];
  /** Whether other fields are allowed, or the schema they must match. */
  additionalProperties?: boolean | BsonJsonSchema;
  /** The schema of array elements. */
  items?: BsonJsonSchema;
  /** The allowed values. */
  enum?: unknown[];
  /** The smallest allowed number. */
  minimum?: number;
  /** The largest allowed number. */
  maximum?: number;
  /** The shortest allowed string. */
  minLength?: number;
  /** The longest allowed string. */
  maxLength?: number;
  /** The regular expression a string must match. */
  pattern?: string;
  /** The schemas of which exactly one must match. */
  oneOf?: BsonJsonSchema[];
  /** A description of the node. */
  description?: string;
}

/**
 * The collection validator: `{ $jsonSchema }` plus level and action.
 *
 * @example
 * ```ts
 * const validator: CollectionValidator = {
 *   validator: { $jsonSchema: { bsonType: "object", required: ["name"] } },
 *   validationLevel: "strict",
 *   validationAction: "error",
 * };
 * declare const db: import("mongodb").Db;
 * await db.command({ collMod: "users", ...validator });
 * ```
 */
export interface CollectionValidator {
  /** The validator document. */
  readonly validator: { readonly $jsonSchema: BsonJsonSchema };
  /** Which documents the validator applies to. */
  readonly validationLevel: "strict" | "moderate" | "off";
  /** What the server does with an invalid document. */
  readonly validationAction: "error" | "warn";
}

/** The BSON type names of each scalar type. */
const BSON_TYPES: Readonly<Record<ScalarType, string | string[]>> = {
  string: "string",
  /* A JS number is stored as int32 or double depending on its value (and as long when it does not fit int32). */
  number: ["int", "double", "long"],
  double: "double",
  int32: "int",
  long: "long",
  decimal128: "decimal",
  boolean: "bool",
  date: "date",
  objectId: "objectId",
  uuid: "binData",
  binary: "binData",
  vector: "binData",
  regex: "regex",
  timestamp: "timestamp",
};

/**
 * `CompiledSchema` → `$jsonSchema` for a collection validator. Generated from the paths tree, so the server
 * refuses documents that break the schema even when something else writes them:
 * - types (`bsonType`, with `"null"` added only for nullable paths — Mongoose made every nested object
 *   nullable), `required` from the explicit option and `_id`;
 * - strict: `additionalProperties: false` at every object level;
 * - `enum`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern` (flag-less RegExp only);
 * - discriminators: `oneOf` over the root and each discriminator, selected by the key's value.
 *
 * Not expressible (checked by Typemo only): user validators, Date bounds, vector dimensions, Map key rules.
 */
export class JsonSchemaGenerator {
  /**
   * The `$jsonSchema` of a document schema (database names).
   *
   * @param source - The model (`connection.model(Entity)`) or its `schema`.
   * @returns The `$jsonSchema` node.
   * @throws {ConfigurationError} When `source` is neither a model nor the schema of one.
   */
  static generate(source: SchemaSource): BsonJsonSchema {
    const schema = SchemaSources.resolve(source, "JsonSchemaGenerator.generate");
    const variants = [...schema.discriminators.values()];
    if (variants.length === 0 || schema.discriminator !== undefined) return JsonSchemaGenerator.object(schema, []);
    const key = schema.discriminatorKey;
    /* Root documents carry no discriminator value: the key is left out of the root variant, so with
       `additionalProperties: false` a document with a value can only match its discriminator's variant. */
    const root = JsonSchemaGenerator.object(schema, []);
    const rootProperties = Object.fromEntries(Object.entries(root.properties ?? {}).filter(([name]) => name !== key));
    const rootRequired = (root.required ?? []).filter((name) => name !== key);
    const rootVariant: BsonJsonSchema = {
      bsonType: "object",
      properties: rootProperties,
      ...(rootRequired.length === 0 ? {} : { required: rootRequired }),
      additionalProperties: false,
    };
    return {
      oneOf: [
        rootVariant,
        ...variants.map((variant): BsonJsonSchema => {
          const object = JsonSchemaGenerator.object(variant, []);
          return {
            ...object,
            properties: {
              ...object.properties,
              [key]: { bsonType: "string", enum: [variant.discriminator?.value as string] },
            },
            required: [...new Set([...(object.required ?? []), key])],
          };
        }),
      ],
    };
  }

  /**
   * The validator options for `createCollection` / `collMod`.
   *
   * @param source - The model (`connection.model(Entity)`) or its `schema`.
   * @returns The validator, level and action.
   * @throws {ConfigurationError} When `source` is neither a model nor the schema of one.
   */
  static validator(source: SchemaSource): CollectionValidator {
    const schema = SchemaSources.resolve(source, "JsonSchemaGenerator.validator");
    const option = schema.options.validator;
    const settings = typeof option === "object" ? option : {};
    return {
      validator: { $jsonSchema: JsonSchemaGenerator.generate(schema) },
      validationLevel: settings.validationLevel ?? "strict",
      validationAction: settings.validationAction ?? "error",
    };
  }

  /**
   * The schema of an object level.
   *
   * @param schema - The compiled schema of the object.
   * @param stack - The schemas being described, outermost first (to stop recursion).
   * @returns The object node.
   */
  private static object(schema: CompiledSchema, stack: readonly CompiledSchema[]): BsonJsonSchema {
    const properties: Record<string, BsonJsonSchema> = {};
    const required: string[] = [];
    for (const node of schema.fields) {
      properties[node.dbKey] = JsonSchemaGenerator.field(node, [...stack, schema]);
      if (node.required || node.key === "_id") required.push(node.dbKey);
    }
    return {
      bsonType: "object",
      properties,
      ...(required.length === 0 ? {} : { required }),
      additionalProperties: false,
    };
  }

  /**
   * The schema of a field: its value schema, with `null` allowed when the field is nullable.
   *
   * @param node - The field node.
   * @param stack - The schemas being described, outermost first.
   * @returns The field node.
   */
  private static field(node: PathNode, stack: readonly CompiledSchema[]): BsonJsonSchema {
    const value = JsonSchemaGenerator.value(node, stack);
    if (!node.nullable) return value;
    const types =
      value.bsonType === undefined
        ? undefined
        : [...(Array.isArray(value.bsonType) ? value.bsonType : [value.bsonType]), "null"];
    return {
      ...value,
      ...(types === undefined ? {} : { bsonType: types }),
      ...(value.enum === undefined ? {} : { enum: [...value.enum, null] }),
    };
  }

  /**
   * The schema of a node's value, by node kind.
   *
   * @param node - The path node.
   * @param stack - The schemas being described, outermost first.
   * @returns The value node.
   */
  private static value(node: PathNode, stack: readonly CompiledSchema[]): BsonJsonSchema {
    switch (node.kind) {
      case "scalar":
        return JsonSchemaGenerator.scalar(node.type, node.options, node.enumValues);
      case "union":
        return { bsonType: [...new Set(node.members.flatMap((member) => BSON_TYPES[member]))] };
      case "array":
        return { bsonType: "array", items: JsonSchemaGenerator.field(node.element, stack) };
      case "map":
        return { bsonType: "object", additionalProperties: JsonSchemaGenerator.field(node.value, stack) };
      case "subdocument":
      case "nested": {
        const child = node.schema;
        /* A recursive schema is described once; deeper levels are only "an object". */
        if (stack.includes(child)) return { bsonType: "object" };
        if (child.discriminators.size > 0 && child.discriminator === undefined)
          return JsonSchemaGenerator.generate(child);
        return JsonSchemaGenerator.object(child, stack);
      }
    }
  }

  /**
   * The schema of a scalar: its BSON type plus the bounds, enum and pattern the server can check.
   *
   * @param type - The scalar type.
   * @param options - The field options.
   * @param enumValues - The allowed values, if any.
   * @returns The scalar node.
   */
  private static scalar(
    type: ScalarType,
    options: Readonly<Record<string, unknown>>,
    enumValues: readonly unknown[] | undefined,
  ): BsonJsonSchema {
    const out: BsonJsonSchema = { bsonType: BSON_TYPES[type] };
    if (enumValues !== undefined && (type === "string" || type === "number" || type === "double" || type === "int32")) {
      out.enum = [...enumValues];
    }
    if (typeof options.min === "number") out.minimum = options.min;
    if (typeof options.max === "number") out.maximum = options.max;
    if (typeof options.minLength === "number") out.minLength = options.minLength;
    if (typeof options.maxLength === "number") out.maxLength = options.maxLength;
    if (options.match instanceof RegExp && options.match.flags === "") out.pattern = options.match.source;
    return out;
  }
}
