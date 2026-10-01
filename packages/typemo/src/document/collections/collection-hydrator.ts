import { BsonGuards } from "../../bson/bson-guards.ts";
import { CastError } from "../../errors/cast-error.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import { SchemaWalker } from "../../schema/compiler/schema-walker.ts";
import { FieldBaseline } from "./field-baseline.ts";
import { HydrationPlans, type StoredContainer } from "./hydration-plan.ts";
import { Lineage } from "./lineage.ts";
import { TrackedArray } from "./strict-array.ts";
import { Subdocuments } from "./subdocument.ts";
import { TrackedSubdocumentArray } from "./subdocument-array.ts";
import { NODE_OF, TO_PLAIN, type TrackedFactory, TrackedProtocol } from "./tracked-protocol.ts";
import { TrackedMap } from "./typed-map.ts";

/**
 * Where hydrated data comes from: the stored form (database names) — from the driver (`driver`: every key an own
 * enumerable data property) or given by the user (`stored`: `Model.hydrate(raw)`) — or a cast of user input
 * (code names).
 *
 * @example
 * ```ts
 * const source: Source = "driver";
 * ```
 */
type Source = "driver" | "stored" | "cast";

/**
 * Whether a node is a subdocument or a nested object.
 *
 * @param node - The path node.
 * @returns `true` for an embedded node.
 */
const isEmbeddedNode = (node: PathNode): boolean => node.kind === "subdocument" || node.kind === "nested";

/**
 * `BsonGuards.isPlainObject` with the common case first: an object whose prototype is `Object.prototype`, with
 * no `Symbol.toStringTag` and no BSON tag, is a plain object (it is not an array, a typed array, a
 * `Date`/`RegExp`/`Map`/`Set`/`ArrayBuffer`, nor a BSON value); anything else takes the full check.
 *
 * @param value - The value to test.
 * @returns `true` for a plain object.
 */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype
    ? !(Symbol.toStringTag in value) && BsonGuards.tagOf(value) === undefined
    : BsonGuards.isPlainObject(value));

/**
 * Builds the tracked values of a hydrated document: from stored data (a read) or from user input
 * (`push`, `set`, `$set`, create), which is cast first through `SchemaWalker` — the same casters and
 * strictness as everywhere (`CastError` at once; unknown keys, `undefined`, non-nullable `null` refused;
 * embedded discriminators chosen by value). Implements the `TrackedFactory` the containers use.
 */
export class CollectionHydrator {
  /** The factory injected into the containers. */
  static readonly factory: TrackedFactory = {
    fromInput: (node, input, path) => CollectionHydrator.fromInput(node, input, path),
  };

  /**
   * A tracked value from the stored (database) form.
   *
   * @param node - The node the value belongs to.
   * @param stored - The stored value.
   * @param partial - Whether an array was loaded in part.
   * @param driver - Whether the value comes from the driver, so a subdocument's stored keys may be counted
   * instead of checked one by one.
   * @returns The hydrated value.
   */
  static fromStored(node: PathNode, stored: unknown, partial = false, driver = false): unknown {
    return CollectionHydrator.hydrate(node, stored, driver ? "driver" : "stored", partial);
  }

  /**
   * A tracked value from user input. A detached tracked value of the same node (a subdocument from
   * `create()`, an element pulled earlier) is adopted as it is; anything else is cast into a new value
   * (a tracked value attached elsewhere is copied, never shared between two owners).
   *
   * @param node - The node the value belongs to.
   * @param input - The user input.
   * @param path - Computes the path, used only for an error message.
   * @returns The tracked or cast value.
   * @throws {CastError} When the input cannot be cast.
   */
  static fromInput(node: PathNode, input: unknown, path: () => string): unknown {
    if (input === null && node.nullable) return null;
    if (TrackedProtocol.is(input) && input[NODE_OF]() === node && Lineage.linkOf(input) === undefined) return input;
    let cast: unknown;
    try {
      cast = SchemaWalker.castValue(node, CollectionHydrator.plainInput(input), "");
    } catch (error) {
      if (!(error instanceof CastError)) throw error;
      const prefix = path();
      throw new CastError({
        path: error.path === "" ? prefix : prefix === "" ? error.path : `${prefix}.${error.path}`,
        value: error.value,
        expected: error.expected,
        reason: error.reason,
        detail: error.detail,
        ...(error.cause === undefined ? {} : { cause: error.cause }),
      });
    }
    return CollectionHydrator.hydrate(node, cast, "cast", false);
  }

  /**
   * Tracked values inside user input become plain data first: the walker validates plain data, and a
   * hydrated subdocument is an instance of its layer class, not of a registered discriminator.
   *
   * @param value - The user input.
   * @returns The input with tracked values replaced by plain data.
   */
  private static plainInput(value: unknown): unknown {
    if (TrackedProtocol.is(value)) return value[TO_PLAIN]({ maps: "map" });
    if (Array.isArray(value)) return value.map(CollectionHydrator.plainInput);
    if (BsonGuards.isPojo(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        Object.defineProperty(out, key, {
          value: CollectionHydrator.plainInput(item),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    return value;
  }

  /**
   * Builds the tracked value of a node from stored data or cast input.
   *
   * @param node - The node the value belongs to.
   * @param value - The stored or cast value.
   * @param source - Where the value comes from.
   * @param partial - Whether an array was loaded in part.
   * @returns The hydrated value.
   */
  private static hydrate(node: PathNode, value: unknown, source: Source, partial: boolean): unknown {
    if (value === null || value === undefined) return value;
    switch (node.kind) {
      case "array": {
        if (!Array.isArray(value)) return value;
        const element = node.element;
        const items = value.map((item: unknown) =>
          item === null ? null : CollectionHydrator.hydrate(element, item, source, false),
        );
        return isEmbeddedNode(element)
          ? TrackedSubdocumentArray.createFor(node, items as object[], CollectionHydrator.factory, partial)
          : TrackedArray.create(node, items, CollectionHydrator.factory, partial);
      }
      case "map": {
        const entries = isRecord(value) ? Object.entries(value) : BsonGuards.isMap(value) ? [...value] : undefined;
        if (entries === undefined) return value;
        return TrackedMap.create(
          node,
          entries.map(([key, item]): [string, unknown] => [
            String(key),
            item === null ? null : CollectionHydrator.hydrate(node.value, item, source, false),
          ]),
          CollectionHydrator.factory,
        );
      }
      case "subdocument":
      case "nested":
        return isRecord(value) ? CollectionHydrator.subdocument(node, node.schema, value, source) : value;
      default:
        /* Stored `Int32`/`Double` wrappers (an encoded insert read back) are numbers, as the server returns them. */
        return source === "cast" ? value : HydrationPlans.storedScalar(value);
    }
  }

  /**
   * Builds a subdocument or nested object from a record.
   *
   * @param node - The node the subdocument hangs on.
   * @param base - The schema of the node; a discriminator's schema is chosen by the record's value.
   * @param record - The stored or cast record.
   * @param source - Where the record comes from.
   * @returns The hydrated subdocument.
   */
  private static subdocument(
    node: PathNode,
    base: CompiledSchema,
    record: Readonly<Record<string, unknown>>,
    source: Source,
  ): object {
    const schema = CollectionHydrator.schemaFor(base, record, source);
    if (source !== "cast") return CollectionHydrator.storedSubdocument(node, schema, record, source);
    const { instance, plan } = Subdocuments.instantiate(schema);
    const known = new Set<string>();
    for (const field of schema.fields) {
      const key = field.key;
      known.add(key);
      /* A subdocument created from input gets its defaults at once (`_id` of `Entity` included), as a new
         root document does; a stored one is taken as stored. */
      const present = Object.hasOwn(record, key);
      if (!present && field.defaultValue === undefined) continue;
      Object.defineProperty(instance, field.key, {
        value: CollectionHydrator.hydrate(field, present ? record[key] : field.defaultValue?.(), source, false),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    /* Keys the schema does not know (the walker refuses them in input; kept as they came otherwise); not
       remembered as unknown stored fields: they are not stored data. */
    for (const [key, value] of Object.entries(record)) {
      if (known.has(key)) continue;
      if (HydrationPlans.keepsUnknown(instance, key)) {
        Object.defineProperty(instance, key, { value, enumerable: true, writable: true, configurable: true });
      }
    }
    Subdocuments.register(instance, schema, plan, node, CollectionHydrator.factory, undefined);
    return instance;
  }

  /**
   * A subdocument from its stored form: filled by the one pass the root document uses too
   * (`HydrationPlans.fill`); the stored keys the schema does not know are remembered, so a save that would drop
   * them can refuse.
   *
   * @param node - The node the subdocument hangs on.
   * @param schema - The subdocument's schema.
   * @param record - The stored record.
   * @param source - `driver` when the record comes from the driver, `stored` when the user gave it.
   * @returns The hydrated subdocument.
   */
  private static storedSubdocument(
    node: PathNode,
    schema: CompiledSchema,
    record: Readonly<Record<string, unknown>>,
    source: "driver" | "stored",
  ): object {
    const { instance, plan } = Subdocuments.instantiate(schema);
    const baseline = FieldBaseline.empty(plan);
    /* The count stands for the exact check only for a driver record. */
    const exact = source === "stored";
    const unknown = HydrationPlans.fill(instance, plan, baseline, record, exact, CollectionHydrator.field, source);
    Subdocuments.register(instance, schema, plan, node, CollectionHydrator.factory, baseline, unknown);
    return instance;
  }

  /**
   * A container field of a stored subdocument (its lineage link is attached by `Subdocuments.register`).
   * An arrow because it is passed as a callback.
   */
  private static readonly field: StoredContainer<"driver" | "stored"> = (field, stored, _target, source) =>
    CollectionHydrator.hydrate(field.node, stored, source, false);

  /**
   * The discriminator schema chosen by the VALUE of the discriminator key, else the base.
   *
   * @param base - The schema of the node.
   * @param record - The stored or cast record.
   * @param source - Where the record comes from (stored records use the database key name).
   * @returns The schema to build the subdocument with.
   */
  private static schemaFor(
    base: CompiledSchema,
    record: Readonly<Record<string, unknown>>,
    source: Source,
  ): CompiledSchema {
    if (base.discriminators.size === 0) return base;
    const key = base.discriminatorKey;
    const storedKey = source === "cast" ? key : (base.field(key)?.dbKey ?? key);
    return base.root.discriminatorFor(record[storedKey]) ?? base;
  }
}
