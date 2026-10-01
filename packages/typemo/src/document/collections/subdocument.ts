import { CastError } from "../../errors/cast-error.ts";
import { InternalError } from "../../errors/internal-error.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import { HydrationSupport } from "../../schema/entity/hydration-support.ts";
import type { ClassRef } from "../../schema/metadata/metadata-types.ts";
import { DocumentInspection, type Inspect } from "../document-inspection.ts";
import { DocumentStates } from "../document-state.ts";
import { PopulatedFields } from "../populated-fields.ts";
import { DirectWriteError } from "./direct-write-error.ts";
import { FieldBaseline } from "./field-baseline.ts";
import { type FieldPlan, type HydrationPlan, HydrationPlans } from "./hydration-plan.ts";
import { Lineage } from "./lineage.ts";
import {
  COMMIT,
  DELTA,
  type FoundUnknown,
  HAS_CHANGES,
  MARK,
  NODE_OF,
  type NodeMark,
  type NodeSnapshot,
  type PathPair,
  type PlainFormOptions,
  type PlainOptions,
  RESET,
  RESTORE,
  REVERT_RESET,
  SNAPSHOT,
  TO_PLAIN,
  type Tracked,
  type TrackedFactory,
  TrackedProtocol,
  UNKNOWN,
  UNMARK,
} from "./tracked-protocol.ts";
import { DeltaBuilder } from "./update-ops.ts";
import { ValueEquality } from "./value-equality.ts";

/**
 * The hidden state of one subdocument or nested object (a `WeakMap` slot: no own property, no name clash).
 *
 * @example
 * ```ts
 * const state = stateOf(user.address); // { schema, plan, node, factory, baseline, known, unknown }
 * ```
 */
interface SubdocumentState {
  /** The schema of the instance (the discriminator's when the value selected one). */
  readonly schema: CompiledSchema;
  /** The hydration plan of the schema (field positions of the baseline). */
  readonly plan: HydrationPlan;
  /** The node the subdocument hangs on (`subdocument`/`nested`, or the element node of an array). */
  readonly node: PathNode;
  /** Creates tracked values from input. */
  readonly factory: TrackedFactory;
  /**
   * Field values at the last reset (identity; a `Date` compared by its time at the reset). They are also
   * the values known to be CAST (read from the database, or sent by a save).
   */
  baseline: FieldBaseline;
  /**
   * Scalar values cast since the last reset (`$set`, a save's own cast; created on the first). A value that is
   * neither this one nor the baseline's was assigned directly and is cast once at the next save.
   */
  known: Map<string, unknown> | undefined;
  /**
   * Stored keys the schema does not declare, remembered at hydration (no extra query). A save that
   * rewrites or replaces this subdocument would lose them: `UnknownFieldsError` unless accepted.
   */
  unknown: readonly string[];
}

/**
 * The saved state of a subdocument.
 *
 * @example
 * ```ts
 * const snapshot = subdocument[SNAPSHOT](); // { kind: "subdocument", values, baseline, known, children }
 * ```
 */
interface SubdocumentSnapshot extends NodeSnapshot {
  /** Discriminates the snapshot kind. */
  readonly kind: "subdocument";
  /** The field values at snapshot time. */
  readonly values: readonly (readonly [string, unknown])[];
  /** The baseline at snapshot time. */
  readonly baseline: FieldBaseline;
  /** The known cast values at snapshot time. */
  readonly known: readonly (readonly [string, unknown])[] | undefined;
  /** The snapshots of the tracked fields by key. */
  readonly children: readonly (readonly [string, NodeSnapshot])[];
}

/**
 * What a write took from a subdocument: its field values as sent, and the marks of its tracked fields.
 *
 * @example
 * ```ts
 * const mark = subdocument[MARK](); // { kind: "subdocument", baseline, children }
 * ```
 */
interface SubdocumentMark extends NodeMark {
  /** Discriminates the mark kind. */
  readonly kind: "subdocument";
  /** Field values at send time: the next baseline and known cast values (`Date`s by their time at send time). */
  readonly baseline: FieldBaseline;
  /** The marks of the tracked fields. */
  readonly children: readonly (readonly [Tracked, NodeMark])[];
}

/**
 * A subdocument seen as a bag of fields.
 *
 * @example
 * ```ts
 * const fields: Record_ = { city: "Oslo" };
 * ```
 */
type Record_ = Record<string, unknown>;

/** The hidden state of every hydrated subdocument. */
const STATES = new WeakMap<object, SubdocumentState>();
/** The layer class of each entity class, built once. */
const LAYERS = new WeakMap<ClassRef, abstract new () => object>();
/** Hydration plans of subdocument schemas (on the subdocument layer). */
const PLANS = new WeakMap<CompiledSchema, HydrationPlan>();
/** The shared empty list of unknown keys. */
const NO_UNKNOWN: readonly string[] = Object.freeze([]);

/**
 * The hidden state of a hydrated subdocument.
 *
 * @param subdocument - A hydrated subdocument.
 * @returns The state stored for it.
 * @throws {InternalError} When the value is not a hydrated subdocument.
 */
const stateOf = (subdocument: object): SubdocumentState => {
  const state = STATES.get(subdocument);
  /* Only instances built by the hydrator have a layer; the layer's methods run only on them. */
  if (state === undefined) throw new InternalError("not a hydrated subdocument");
  return state;
};

/**
 * The value of a scalar field known to be cast: cast since the reset, else the baseline's.
 *
 * @param state - The subdocument's state.
 * @param field - The field plan.
 * @returns The known cast value, or `undefined` when there is none.
 */
const knownValue = (state: SubdocumentState, field: FieldPlan): unknown =>
  state.known?.has(field.key) ? state.known.get(field.key) : state.baseline.identity(field.index);

/**
 * A scalar field assigned directly (not by `$set`, not read from the database) is cast ONCE, at the save
 * that sends it, and the cast value is written back (the pipeline does not cast document values
 * again, so a user `set` runs once; Mongoose H508).
 *
 * @param subdocument - The subdocument's fields.
 * @param state - The subdocument's state.
 * @param field - The field plan.
 * @param path - The full path of the subdocument, for error messages.
 * @throws {CastError} When the assigned value cannot be cast.
 */
const castAssigned = (subdocument: Record_, state: SubdocumentState, field: FieldPlan, path: string): void => {
  const node = field.node;
  if (node.kind !== "scalar" && node.kind !== "union") return;
  if (!Object.hasOwn(subdocument, node.key)) return;
  const value = PopulatedFields.stored(subdocument, node.key, subdocument[node.key]);
  if (value === undefined || value === knownValue(state, field)) return;
  const cast = node.caster.cast(value, path);
  if (cast !== value) {
    Object.defineProperty(subdocument, node.key, { value: cast, enumerable: true, writable: true, configurable: true });
  }
  state.known ??= new Map();
  state.known.set(node.key, cast);
};

/**
 * How a field of a subdocument differs from its baseline.
 *
 * @param subdocument - The subdocument's fields.
 * @param state - The subdocument's state.
 * @param field - The field plan.
 * @returns `none`, `unset`, `set`, `child` (a change inside a tracked value) or `replaced` (a container swapped).
 */
const fieldChange = (
  subdocument: Record_,
  state: SubdocumentState,
  field: FieldPlan,
): "none" | "unset" | "set" | "child" | "replaced" => {
  const node = field.node;
  /* A populated field is compared by its stored ids. */
  const current = PopulatedFields.stored(
    subdocument,
    node.key,
    Object.hasOwn(subdocument, node.key) ? subdocument[node.key] : undefined,
  );
  const baseline = state.baseline;
  const base = baseline.identity(field.index);
  if (current === undefined) return base === undefined ? "none" : "unset";
  /* A `Date` can change in place: compared by its time at the reset, never by identity. */
  if (baseline.isDate(field.index)) return baseline.sameDate(field.index, current) ? "none" : "set";
  if (current === base) return TrackedProtocol.is(current) && current[HAS_CHANGES]() ? "child" : "none";
  if (field.container && current !== null) {
    /* A container replaced around `$set` (a cast or JS assignment): the type forbids it. */
    return TrackedProtocol.is(current) && Lineage.isAttachedTo(current, subdocument) ? "set" : "replaced";
  }
  return ValueEquality.equals(current, base) ? "none" : "set";
};

/**
 * Hydrated subdocuments and nested objects. A subdocument IS an instance of its entity
 * class (methods, getters and `#private` work, `instanceof` holds). The `$`-methods and the tracking
 * protocol come from a LAYER: a subclass `class extends UserClass {}` built once per class, instances
 * created with `Reflect.construct(UserClass, [], Layer)` — so the user's constructor runs, and no foreign
 * prototype is patched. The state lives in a `WeakMap`; the data are own enumerable properties (as in
 * `DocumentReader`), so spread, `JSON.stringify` and `structuredClone` see exactly the data.
 *
 * Field changes are found at save by comparing with the baseline (the values at the last reset); the
 * index inside an array is derived at save (`Lineage`, Mongoose H029). A nested object
 * (`@Schema({ nested: true })`) is the same runtime without `_id` and without own hooks.
 */
export class Subdocuments {
  /**
   * A fresh instance of the schema's class with the layer (no own `undefined` schema properties).
   *
   * @param schema - The compiled schema of the subdocument class.
   * @returns The instance and the hydration plan of its schema.
   */
  static instantiate(schema: CompiledSchema): { readonly instance: Record_; readonly plan: HydrationPlan } {
    const instance = Reflect.construct(schema.target, [], Subdocuments.layerOf(schema.target)) as Record_;
    const plan = HydrationPlans.of(PLANS, schema, instance);
    /* Skipped when the first instance of the class had no own `undefined` schema property. */
    if (plan.clean) HydrationSupport.clean(schema, instance);
    return { instance, plan };
  }

  /**
   * Registers a filled instance: its state and the links of its tracked fields. `baseline` holds the values put
   * on the instance (recorded while it was filled); `undefined` takes them from the instance.
   *
   * @param instance - The filled instance.
   * @param schema - The compiled schema of the instance.
   * @param plan - The hydration plan of the schema.
   * @param node - The node the subdocument hangs on.
   * @param factory - Creates tracked values from input.
   * @param baseline - The recorded baseline, or `undefined` to read it from the instance.
   * @param unknown - The stored keys the schema does not declare.
   */
  static register(
    instance: Record_,
    schema: CompiledSchema,
    plan: HydrationPlan,
    node: PathNode,
    factory: TrackedFactory,
    baseline: FieldBaseline | undefined,
    unknown: readonly string[] = NO_UNKNOWN,
  ): void {
    STATES.set(instance, {
      schema,
      plan,
      node,
      factory,
      baseline: baseline ?? Subdocuments.baselineOf(instance, plan),
      known: undefined,
      unknown: unknown.length === 0 ? NO_UNKNOWN : Object.freeze([...unknown]),
    });
    for (const field of plan.containers) {
      if (Object.hasOwn(instance, field.key)) Lineage.attach(instance[field.key], instance, field.key);
    }
  }

  /**
   * `true` for an instance built by the hydrator.
   *
   * @param value - The value to test.
   * @returns `true` when the value is a hydrated subdocument.
   */
  static isSubdocument(value: unknown): value is Record_ {
    return typeof value === "object" && value !== null && STATES.has(value);
  }

  /**
   * Casts the scalar fields assigned directly inside a field value, at any depth: the fields of a subdocument,
   * of the subdocuments in an array and of those in a Map (values put in by the collections' own methods are
   * cast already). The cast value is written back, once, as the save does for the root fields.
   *
   * @param value - The value of a container field (a subdocument, an array, a Map; anything else is skipped).
   * @param path - The value's code path, for the error.
   * @throws {CastError} At the first directly assigned value that cannot be cast, in the order of the fields.
   */
  static castAssigned(value: unknown, path: string): void {
    if (Subdocuments.isSubdocument(value)) {
      const state = stateOf(value);
      for (const field of state.plan.fields) {
        const at = path === "" ? field.node.key : `${path}.${field.node.key}`;
        castAssigned(value, state, field, at);
        if (field.container && Object.hasOwn(value, field.node.key)) {
          Subdocuments.castAssigned(PopulatedFields.stored(value, field.node.key, value[field.node.key]), at);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => {
        Subdocuments.castAssigned(item, `${path}.${index}`);
      });
      return;
    }
    if (value instanceof Map)
      for (const [key, item] of value) Subdocuments.castAssigned(item, `${path}.${String(key)}`);
  }

  /**
   * The unknown stored keys of a subdocument are gone from the database (a save accepted the loss):
   * they are forgotten and removed from the instance, so memory and database agree.
   *
   * @param subdocument - A hydrated subdocument.
   */
  static forgetUnknown(subdocument: object): void {
    const state = STATES.get(subdocument);
    if (state === undefined || state.unknown.length === 0) return;
    for (const key of state.unknown) {
      /* A stored key under the code name of a renamed field is unknown data, never on the instance: the own
         property of that name is the field's. */
      if (!state.plan.renamedKeys.has(key)) delete (subdocument as Record_)[key];
    }
    state.unknown = [];
  }

  /**
   * The schema of a hydrated subdocument.
   *
   * @param subdocument - A hydrated subdocument.
   * @returns The compiled schema of the instance.
   * @throws {InternalError} When the value is not a hydrated subdocument.
   */
  static schemaOf(subdocument: object): CompiledSchema {
    return stateOf(subdocument).schema;
  }

  /**
   * The baseline of the current stored values of the fields (a populated field: its ids); `Date`s by their
   * time now.
   *
   * @param instance - The instance to read.
   * @param plan - The hydration plan of its schema.
   * @returns The baseline of the current values.
   */
  private static baselineOf(instance: Record_, plan: HydrationPlan): FieldBaseline {
    const baseline = FieldBaseline.empty(plan);
    for (const field of plan.fields) {
      if (!Object.hasOwn(instance, field.key)) continue;
      const value = PopulatedFields.stored(instance, field.key, instance[field.key]);
      if (value !== undefined) baseline.record(field.index, value, field.container);
    }
    return baseline;
  }

  /**
   * The layer class of an entity class, built once.
   *
   * @param target - The entity class.
   * @returns The cached or newly built layer class.
   */
  private static layerOf(target: ClassRef): abstract new () => object {
    const cached = LAYERS.get(target);
    if (cached !== undefined) return cached;
    const layer = Subdocuments.buildLayer(target as abstract new () => object);
    LAYERS.set(target, layer);
    return layer;
  }

  /**
   * Builds the layer class: `class extends target` carrying the `$`-methods and the tracking protocol.
   *
   * @param target - The entity class.
   * @returns The layer class.
   */
  private static buildLayer(target: abstract new () => object): abstract new () => object {
    /* The methods run on instances created through `Reflect.construct(target, [], Layer)`: `this` is
       the user's instance, whose hidden state is in `STATES`. */
    abstract class Layer extends target implements Tracked {
      /**
       * The document or subdocument this one hangs on.
       *
       * @returns The parent, or `undefined` for a detached subdocument.
       */
      $parent(): object | undefined {
        return Lineage.parentDocument(this);
      }

      /**
       * The array this subdocument is an element of.
       *
       * @returns The array, or `undefined` when the subdocument is not an array element.
       */
      $parentArray(): unknown {
        const link = Lineage.linkOf(this);
        return link !== undefined && link.key === undefined && Array.isArray(link.owner) ? link.owner : undefined;
      }

      /**
       * The current position of this subdocument inside its array.
       *
       * @returns The index, derived from the array at the time of the call.
       */
      $index(): number {
        return Lineage.index(this);
      }

      /**
       * The full path of this subdocument from its root document.
       *
       * @returns The path, or `undefined` when the subdocument is detached.
       */
      $fullPath(): string | undefined {
        return Lineage.fullPath(this);
      }

      /**
       * The top-level document that contains this subdocument.
       *
       * @returns The owner document, or `undefined` when the root is itself embedded or detached.
       */
      $ownerDocument(): object | undefined {
        const root = Lineage.root(this);
        return Lineage.isEmbedded(root) ? undefined : root;
      }

      /**
       * Whether the document this subdocument belongs to has not been inserted yet: the owner's `$isNew()`, so a
       * document hook of the class answers the same whether it runs on the root or on the subdocument.
       *
       * @returns The owner document's answer; `true` when the subdocument is detached (nothing stored it yet).
       */
      $isNew(): boolean {
        const root = Lineage.root(this);
        return DocumentStates.is(root) ? DocumentStates.of(root).isNew : true;
      }

      /**
       * A subdocument, not a root document (a root document answers `true`).
       *
       * @returns `false`.
       */
      $isRoot(): boolean {
        return false;
      }

      /**
       * Whether a field of this subdocument, or `path` (relative to it), an ancestor or a descendant of it, changed
       * since the last load or save: the rule of the document's `$isModified`.
       *
       * @param path - Limits the check to this path; any change counts when omitted.
       * @returns `true` when modified.
       */
      $isModified(path?: string): boolean {
        if (!this[HAS_CHANGES]()) return false;
        const out = new DeltaBuilder("code", false);
        try {
          this[DELTA]({ code: "", db: "" }, out);
        } catch {
          /* A partially loaded array refuses the ops, but it is still modified (as `Collections.modifiedPaths`). */
          return true;
        }
        const paths = out.result().modifiedPaths;
        if (path === undefined) return paths.length > 0;
        return paths.some(
          (changed) => changed === path || changed.startsWith(`${path}.`) || path.startsWith(`${changed}.`),
        );
      }

      /**
       * Assigns a field through the cast pipeline and remembers the cast value as known.
       *
       * @param key - The field name (the code name, not the database name).
       * @param value - The value to cast and assign.
       * @returns This subdocument.
       * @throws {CastError} When `key` is not a field of the schema, or the value cannot be cast.
       */
      $set(key: string, value: unknown): this {
        const state = stateOf(this);
        const node = state.schema.field(key);
        const path = (): string => {
          const base = Lineage.fullPath(this);
          return base === undefined || base === "" ? key : `${base}.${key}`;
        };
        if (node === undefined) {
          throw new CastError({
            path: path(),
            value,
            expected: state.schema.name,
            reason: "unknown-key",
            detail: `not a field of ${state.schema.name}`,
          });
        }
        const cast = state.factory.fromInput(node, value, path);
        const self = this as unknown as Record_;
        const previous = self[key];
        Object.defineProperty(self, key, { value: cast, enumerable: true, writable: true, configurable: true });
        state.known ??= new Map();
        state.known.set(key, cast);
        if (previous !== cast) Lineage.detach(previous);
        Lineage.attach(cast, this, key);
        return this;
      }

      /**
       * The plain object of this subdocument; maps stay `Map`s.
       *
       * @returns A plain copy of the data.
       */
      $toObject(): unknown {
        return this[TO_PLAIN]({ maps: "map" });
      }

      /**
       * What `console.log` and `util.inspect` print: the class name and the data (`$toObject`; no `$parent`, no internals).
       *
       * @param depth - The remaining depth.
       * @param options - The inspect options of the caller.
       * @param inspect - The caller's `util.inspect`.
       * @returns The text.
       */
      [DocumentInspection.CUSTOM](depth: number, options: object | undefined, inspect: Inspect): string {
        return DocumentInspection.render(this, () => this[TO_PLAIN]({ maps: "map" }), depth, options, inspect);
      }

      /**
       * The plain form of this subdocument with the given options.
       *
       * @param options - Plain-form options.
       * @returns A plain copy of the data.
       */
      $toPlain(options?: PlainFormOptions): unknown {
        return TrackedProtocol.plainForm(this, options);
      }

      /**
       * Adds the changes of this subdocument to the delta: each field is compared with its baseline.
       *
       * @param at - The path of this subdocument.
       * @param out - The delta being built.
       * @throws {DirectWriteError} When a container field was replaced by assignment (strict mode).
       * @throws {CastError} When a directly assigned scalar cannot be cast (strict mode).
       */
      [DELTA](at: PathPair, out: DeltaBuilder): void {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        for (const field of state.plan.fields) {
          const node = field.node;
          if (out.strict) castAssigned(self, state, field, TrackedProtocol.join(at, node.key, node.dbKey).code);
          const change = fieldChange(self, state, field);
          if (change === "none") continue;
          const child = TrackedProtocol.join(at, node.key, node.dbKey);
          switch (change) {
            case "unset":
              out.add("$unset", child, "", "none");
              break;
            case "child":
              (PopulatedFields.stored(self, node.key, self[node.key]) as Tracked)[DELTA](child, out);
              break;
            case "replaced":
              if (out.strict) {
                throw new DirectWriteError(
                  child.code,
                  `the field was replaced by assignment; use $set("${node.key}", value) or the container's methods`,
                );
              }
              out.touched(child);
              break;
            case "set": {
              const value = PopulatedFields.stored(self, node.key, self[node.key]);
              /* The stored container or subdocument this field held is replaced as a whole. */
              const previous = state.baseline.get(node.key);
              if (previous !== value && field.container) out.replaced(previous, child);
              out.add("$set", child, value === null ? null : out.value(node, value), "none");
              break;
            }
          }
        }
      }

      /**
       * Whether any field differs from its baseline.
       *
       * @returns `true` when at least one field changed.
       */
      [HAS_CHANGES](): boolean {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        return state.plan.fields.some((field) => fieldChange(self, state, field) !== "none");
      }

      /** Makes the current values the new baseline, forgets the known cast values and resets tracked children. */
      [RESET](): void {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        state.baseline = Subdocuments.baselineOf(self, state.plan);
        state.known = undefined;
        for (const field of state.plan.containers) {
          const value = self[field.key];
          if (TrackedProtocol.is(value)) value[RESET]();
        }
      }

      /**
       * Captures the values, baseline and known cast values so a failed write can be rolled back.
       *
       * @returns The snapshot, including the snapshots of tracked children.
       */
      [SNAPSHOT](): SubdocumentSnapshot {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        const values: [string, unknown][] = [];
        const children: [string, NodeSnapshot][] = [];
        for (const node of state.schema.fields) {
          if (!Object.hasOwn(self, node.key)) continue;
          const value = self[node.key];
          values.push([node.key, value]);
          if (TrackedProtocol.is(value)) children.push([node.key, value[SNAPSHOT]()]);
        }
        return {
          kind: "subdocument",
          values,
          baseline: state.baseline.copy(),
          known: state.known === undefined ? undefined : [...state.known],
          children,
        };
      }

      /**
       * Puts back the state captured by {@link SNAPSHOT}: values, baseline, known values and children.
       *
       * @param snapshot - The snapshot taken earlier from this subdocument.
       */
      [RESTORE](snapshot: NodeSnapshot): void {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        const saved = snapshot as SubdocumentSnapshot;
        const values = new Map(saved.values);
        for (const node of state.schema.fields) {
          const current = self[node.key];
          if (values.has(node.key)) {
            const value = values.get(node.key);
            if (current !== value) Lineage.detach(current);
            Object.defineProperty(self, node.key, { value, enumerable: true, writable: true, configurable: true });
            Lineage.attach(value, this, node.key);
          } else if (Object.hasOwn(self, node.key)) {
            Lineage.detach(current);
            delete self[node.key];
          }
        }
        state.baseline = saved.baseline.copy();
        state.known = saved.known === undefined ? undefined : new Map(saved.known);
        for (const [key, child] of saved.children) {
          const value = self[key];
          if (TrackedProtocol.is(value)) value[RESTORE](child);
        }
      }

      /**
       * Restores only the baseline after a failed write; the values stay as the user left them.
       *
       * @param snapshot - The snapshot taken before the write.
       */
      [REVERT_RESET](snapshot: NodeSnapshot): void {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        const saved = snapshot as SubdocumentSnapshot;
        /* The baseline before the failed write is the stored state again; the diff then covers the
           changes of before the write and those made while it was in flight. */
        state.baseline = saved.baseline.copy();
        const values = new Map(saved.values);
        for (const [key, child] of saved.children) {
          const value = self[key];
          if (value === values.get(key) && TrackedProtocol.is(value)) value[REVERT_RESET](child);
        }
      }

      /**
       * Takes what a write sends: the field values as sent and the marks of tracked children.
       *
       * @returns The mark to pass to {@link COMMIT} or {@link UNMARK}.
       */
      [MARK](): SubdocumentMark {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        /* A `Date` changed in place while the write is in flight must still differ from what was sent: the
           baseline keeps its time now. */
        const baseline = Subdocuments.baselineOf(self, state.plan);
        const children: [Tracked, NodeMark][] = [];
        for (const field of state.plan.containers) {
          const value = baseline.identity(field.index);
          if (TrackedProtocol.is(value)) children.push([value, value[MARK]()]);
        }
        return { kind: "subdocument", baseline, children };
      }

      /**
       * Confirms a successful write: what was sent becomes the baseline.
       *
       * @param mark - The mark taken by {@link MARK} before the write.
       */
      [COMMIT](mark: NodeMark): void {
        const state = stateOf(this);
        const sent = mark as SubdocumentMark;
        /* The baseline is what was SENT: a field changed while the write was in flight stays a change. */
        state.baseline = sent.baseline;
        state.known = undefined;
        for (const [value, child] of sent.children) value[COMMIT](child);
      }

      /**
       * Drops a mark without applying it (the write was not sent or failed).
       *
       * @param mark - The mark taken by {@link MARK}.
       */
      [UNMARK](mark: NodeMark): void {
        for (const [value, child] of (mark as SubdocumentMark).children) value[UNMARK](child);
      }

      /**
       * Collects the stored keys the schema does not declare, here and in tracked children.
       *
       * @param path - The path of this subdocument.
       * @param found - The list to append to.
       */
      [UNKNOWN](path: string, found: FoundUnknown[]): void {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        if (state.unknown.length > 0) found.push({ path, keys: state.unknown, owner: this });
        for (const node of state.schema.fields) {
          const value = self[node.key];
          if (TrackedProtocol.is(value)) value[UNKNOWN](path === "" ? node.key : `${path}.${node.key}`, found);
        }
      }

      /**
       * The plain object of this subdocument.
       *
       * @param options - Plain-form options.
       * @returns A fresh object with the field values.
       */
      [TO_PLAIN](options: PlainOptions): Record_ {
        const state = stateOf(this);
        const self = this as unknown as Record_;
        const out: Record_ = {};
        for (const node of state.schema.fields) {
          if (!Object.hasOwn(self, node.key) || self[node.key] === undefined) continue;
          /* A populated field is its stored ids: a whole write sends them. */
          const value = TrackedProtocol.toPlain(PopulatedFields.stored(self, node.key, self[node.key]), options);
          /* A fresh `{}`: assignment is the same own data property for every key but `__proto__`. */
          if (node.key === "__proto__") {
            Object.defineProperty(out, node.key, { value, enumerable: true, writable: true, configurable: true });
          } else {
            out[node.key] = value;
          }
        }
        return out;
      }

      /**
       * The schema node this subdocument hangs on.
       *
       * @returns The path node.
       */
      [NODE_OF](): PathNode {
        return stateOf(this).node;
      }
    }
    Object.defineProperty(Layer, "name", { value: target.name });
    return Layer;
  }
}
