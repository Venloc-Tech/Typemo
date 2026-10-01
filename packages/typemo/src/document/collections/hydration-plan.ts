import { BsonGuards } from "../../bson/bson-guards.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import type { FieldBaseline } from "./field-baseline.ts";

/**
 * One field of a schema, as hydration walks it.
 *
 * @example
 * ```ts
 * const field: FieldPlan = plan.fields[0]; // { node, index: 0, key: "name", dbKey: "n", ... }
 * ```
 */
export interface FieldPlan {
  /** The field node. */
  readonly node: PathNode;
  /** Position in `schema.fields` (and in the baselines). */
  readonly index: number;
  /** The code key. */
  readonly key: string;
  /** The stored (database) key. */
  readonly dbKey: string;
  /** `array | map | subdocument | nested`: hydrated into a tracked value. */
  readonly container: boolean;
  /** The stored name is also a member of `Object.prototype` (`constructor`, `toString`, …): read it with `hasOwn`. */
  readonly inheritedDbKey: boolean;
  /** Plain assignment is equivalent to `defineProperty` on instances of this layer. */
  readonly assign: boolean;
}

/**
 * How a container field's stored value becomes its tracked value — the root document and the subdocuments build
 * it differently (lineage, partial arrays). `arg` carries what the caller needs (no closure per document).
 *
 * @example
 * ```ts
 * const container: StoredContainer<Source> = (field, stored, target, source) => hydrate(field.node, stored, source);
 * ```
 */
export type StoredContainer<A> = (
  field: FieldPlan,
  stored: unknown,
  target: Record<string, unknown>,
  arg: A,
) => unknown;

/**
 * What hydration needs to know about a schema, computed ONCE per schema and layer instead of per document: the
 * fields in order with their flags, the code key → position index of the baselines, and two facts about the
 * instances of the class, taken from the FIRST instance the layer builds (its constructor runs before any data
 * is put in; it must take no arguments, so every instance starts the same):
 * - `clean` — whether the constructor leaves own `undefined` properties of schema paths (define semantics) that
 *   hydration must delete. When the first instance has none, `HydrationSupport.clean` is skipped;
 * - `assign` per field — whether a plain assignment `instance[key] = value` creates exactly the own property
 *   `Object.defineProperty(instance, key, { value, enumerable, writable, configurable })` would: no accessor and
 *   no read-only property of that name on the prototype chain, no own property with other attributes, and not
 *   `__proto__`. Assignment is several times cheaper than `defineProperty`; where it is not safe the field
 *   keeps `defineProperty`, so `Object.keys`, spread, `JSON.stringify`, `structuredClone` and `hasOwn` see the
 *   same data either way.
 *
 * ASSUMPTION: the class prototype is IMMUTABLE after the first `model()` of the class. `assign` is decided once,
 * from the prototype chain as it is when the plan is built. A setter or a read-only property with the name of a
 * field added to the prototype later (a mixin applied late, `Object.defineProperty(Class.prototype, …)`) is not
 * seen: hydration would assign through the setter instead of creating the own data property. The prototype is
 * not checked at run time.
 */
export class HydrationPlan {
  /** The fields in schema order. */
  readonly fields: readonly FieldPlan[];
  /** Code key → position. */
  readonly index: ReadonlyMap<string, number>;
  /** Stored names of the fields (the test for stored keys the schema does not know). */
  readonly dbKeys: ReadonlySet<string>;
  /**
   * The CODE names of the fields renamed by `dbName` that are not the stored name of another field. A stored
   * key with such a name is data from before the rename — unknown to the schema, never put on the instance (it
   * would shadow the field and be saved under its new name).
   */
  readonly renamedKeys: ReadonlySet<string>;
  /** The constructor leaves own `undefined` schema properties: `HydrationSupport.clean` must run. */
  readonly clean: boolean;
  /** Fields with a default that is not a service field (applied on a read). */
  readonly defaults: readonly FieldPlan[];
  /** Container fields (the only ones that get a lineage link). */
  readonly containers: readonly FieldPlan[];
  /** The version field (`__v`), if the schema has one. */
  readonly version: FieldPlan | undefined;

  /**
   * @param schema - The compiled schema.
   * @param first - The first instance of the layer, before any data is put in.
   */
  constructor(schema: CompiledSchema, first: object) {
    const fields = schema.fields.map(
      (node, index): FieldPlan => ({
        node,
        index,
        key: node.key,
        dbKey: node.dbKey,
        container: HydrationPlan.isContainer(node),
        inheritedDbKey: node.dbKey in Object.prototype,
        assign: HydrationPlan.assignable(first, node.key),
      }),
    );
    this.fields = fields;
    this.index = new Map(fields.map((field) => [field.key, field.index]));
    const dbKeys = new Set(fields.map((field) => field.dbKey));
    this.dbKeys = dbKeys;
    this.renamedKeys = new Set(
      fields.filter((field) => field.key !== field.dbKey && !dbKeys.has(field.key)).map((field) => field.key),
    );
    this.clean = [...schema.fields.map((field) => field.key), ...schema.virtuals.map((virtual) => virtual.key)].some(
      (key) => Object.hasOwn(first, key) && (first as Record<string, unknown>)[key] === undefined,
    );
    this.defaults = fields.filter((field) => field.node.defaultValue !== undefined && field.node.service === undefined);
    this.containers = fields.filter((field) => field.container);
    this.version = fields.find((field) => field.node.service === "version");
  }

  /**
   * Whether a node is hydrated into a tracked value: `array | map | subdocument | nested` (the one definition).
   *
   * @param node - The path node.
   * @returns `true` for a container node.
   */
  static isContainer(node: PathNode): boolean {
    return node.kind === "array" || node.kind === "map" || node.kind === "subdocument" || node.kind === "nested";
  }

  /**
   * Whether `instance[key] = value` gives the same own data property as a full `defineProperty`. An own
   * `undefined` property left by the constructor is ignored: `clean` deletes it before any data is put in. Decided
   * once, from the prototype chain when the plan is built.
   *
   * @param instance - The first instance of the layer.
   * @param key - The field's code key.
   * @returns `true` when plain assignment is safe.
   */
  private static assignable(instance: object, key: string): boolean {
    if (key === "__proto__") return false;
    const own = Object.getOwnPropertyDescriptor(instance, key);
    if (own !== undefined && !("value" in own && own.value === undefined)) {
      return "value" in own && own.writable === true && own.enumerable === true && own.configurable === true;
    }
    for (let proto = Object.getPrototypeOf(instance); proto !== null; proto = Object.getPrototypeOf(proto)) {
      const found = Object.getOwnPropertyDescriptor(proto, key);
      if (found !== undefined) return "value" in found && found.writable === true;
    }
    return true;
  }
}

/** Plans cached per schema, one cache per layer kind (root documents and subdocuments have different layers). */
export class HydrationPlans {
  /**
   * The plan of `schema` in `cache`; `first` is a fresh instance of its layer (before `clean`), used only when
   * the plan is built.
   *
   * @param cache - The cache of the layer kind.
   * @param schema - The compiled schema.
   * @param first - A fresh instance of the layer.
   * @returns The cached or newly built plan.
   */
  static of(cache: WeakMap<CompiledSchema, HydrationPlan>, schema: CompiledSchema, first: object): HydrationPlan {
    let plan = cache.get(schema);
    if (plan === undefined) {
      plan = new HydrationPlan(schema, first);
      cache.set(schema, plan);
    }
    return plan;
  }

  /**
   * Puts `value` as the own enumerable data property `field.key` of `target` (assignment where equivalent).
   *
   * @param target - The instance to write to.
   * @param field - The field plan.
   * @param value - The value.
   */
  static put(target: Record<string, unknown>, field: FieldPlan, value: unknown): void {
    if (field.assign) target[field.key] = value;
    else Object.defineProperty(target, field.key, { value, enumerable: true, writable: true, configurable: true });
  }

  /**
   * Whether a key the schema does not know may be kept on the hydrated (sub)document: only when it does not
   * SHADOW a member of the class — a method, an accessor, or `Object.prototype`'s (`toString`, `constructor`, …;
   * Mongoose H474, H069). Stored data named like a method replaced the method (`doc.describe is not a
   * function`). A shadowing key is not put on the document (it is in the database and in `lean()`); it still
   * counts as an unknown stored field, so a save that would rewrite the (sub)document without it refuses.
   *
   * @param target - The instance.
   * @param key - The unknown stored key.
   * @returns `true` when the key can be put on the instance.
   */
  static keepsUnknown(target: object, key: string): boolean {
    return !(key in target) || Object.hasOwn(target, key);
  }

  /**
   * The hydrated form of a stored SCALAR value: the value itself; the `Int32`/`Double` wrappers of an encoded
   * insert read back are numbers, as the server returns them.
   *
   * @param value - The stored value.
   * @returns The hydrated value.
   */
  static storedScalar(value: unknown): unknown {
    return typeof value === "object" && value !== null && (BsonGuards.isInt32(value) || BsonGuards.isDouble(value))
      ? value.valueOf()
      : value;
  }

  /**
   * The number of enumerable string keys of a stored record (no array allocated): equal to the number of
   * schema fields found in it when it has no other key.
   *
   * @param record - The stored record.
   * @returns The key count.
   */
  static ownKeyCount(record: object): number {
    let count = 0;
    for (const key in record) if (Object.hasOwn(record, key)) count++;
    return count;
  }

  /**
   * Fills a fresh (sub)document instance from its STORED form (the one loop of the root and the subdocuments):
   * one pass over the fields in schema order, each value put on `target` and recorded in `baseline` where it is
   * hydrated; scalars need no tracked wrapper; containers go through `container`.
   *
   * `exact` is `false` only for a record from the DRIVER (every key an own enumerable data property). Otherwise
   * (`Model.hydrate(raw)`, any record a user built) fields are read from OWN properties only — a value or a getter
   * on the record's prototype chain is never read — and the pass over the stored keys always runs. For a driver
   * record the keys are counted first and that pass runs only when there are more than the fields found.
   *
   * Keys the schema does not know (a text score, a computed field of a projection) are kept on `target` as they
   * came — never over a member of the class ({@link keepsUnknown}) and never under the code name of a renamed
   * field. Returns them, or `undefined` when the pass did not run.
   *
   * @param target - The fresh instance.
   * @param plan - The hydration plan of its schema.
   * @param baseline - The baseline to record the values in.
   * @param raw - The stored record.
   * @param exact - `false` for a driver record.
   * @param container - Builds the tracked value of a container field.
   * @param arg - Passed through to `container`.
   * @returns The stored keys the schema does not know, or `undefined` when the pass did not run.
   */
  static fill<A>(
    target: Record<string, unknown>,
    plan: HydrationPlan,
    baseline: FieldBaseline,
    raw: Readonly<Record<string, unknown>>,
    exact: boolean,
    container: StoredContainer<A>,
    arg: A,
  ): string[] | undefined {
    let matched = 0;
    for (const field of plan.fields) {
      let stored: unknown;
      if (exact || field.inheritedDbKey) {
        if (!Object.hasOwn(raw, field.dbKey)) continue;
        stored = raw[field.dbKey];
      } else {
        stored = raw[field.dbKey];
        if (stored === undefined && !Object.hasOwn(raw, field.dbKey)) continue;
      }
      matched++;
      const value =
        stored === null || stored === undefined
          ? stored
          : field.container
            ? container(field, stored, target, arg)
            : HydrationPlans.storedScalar(stored);
      HydrationPlans.put(target, field, value);
      if (value !== undefined) baseline.record(field.index, value, field.container);
    }
    if (!exact && HydrationPlans.ownKeyCount(raw) === matched) return undefined;
    const unknown: string[] = [];
    for (const [key, value] of Object.entries(raw)) {
      if (plan.dbKeys.has(key)) continue;
      unknown.push(key);
      if (plan.renamedKeys.has(key) || !HydrationPlans.keepsUnknown(target, key)) continue;
      Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return unknown;
  }
}
