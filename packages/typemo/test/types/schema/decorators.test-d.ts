/*
 * Type tests of the decorators. Every `@ts-expect-error` says what must fail; `schema-type-tests.test.ts`
 * compiles this file with emitDecoratorMetadata ON and OFF, and the hover tests check the exact messages.
 * Compiled by `bun run test:types` too.
 */
import { type Binary, Decimal128, ObjectId, UUID } from "mongodb";
import {
  type Computed,
  type Defaulted,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Hidden,
  type Immutable,
  Index,
  type OperationHookContext,
  Plugin,
  Post,
  PostError,
  Pre,
  Prop,
  type Ref,
  Schema,
  type SchemaPlugin,
  Spec,
  Timestamped,
  Types,
  type Vector,
  Versioned,
  Virtual,
  type VirtualRef,
} from "../../../src/index.ts";

enum Color {
  Red = "red",
  Blue = "blue",
}
enum Level {
  Low,
  High,
}

@Schema()
export class Tag {
  @Prop(() => String) label!: string;
}

@Schema()
export class Special extends Tag {
  @Prop(() => Number) weight!: number;
}

// --- positive: every spec and option compiles when it agrees with the field ------------------------

@Index({ name: 1, "tags.label": -1 })
@Index(
  { name: "text" },
  { weights: { name: 2 }, partialFilterExpression: { $or: [{ age: { $gt: 1 } }, { name: "x" }] } },
)
@Schema({ collection: "positives", timeseries: { timeField: "at", metaField: "name" }, discriminatorKey: "kind" })
export class Positive extends Versioned(Timestamped(Entity)) {
  @Prop(() => String, { required: true, trim: true, minLength: 1, validate: (v) => v.length < 50 || "too long" })
  name!: string;
  @Prop(() => String) kind!: string;
  @Prop(() => Number, { default: 0, min: 0 }) age!: Defaulted<number>;
  @Prop(() => Types.Int32, { max: 10 }) small?: number;
  @Prop(() => Types.Double) ratio?: number;
  @Prop(() => BigInt, { min: 0n }) big?: bigint;
  @Prop(() => Decimal128) money?: Decimal128;
  @Prop(() => Date, { required: true, expires: 60 }) at!: Date;
  @Prop(() => Boolean, { default: () => false }) flag!: Defaulted<boolean>;
  @Prop(() => ObjectId, { ref: () => Positive }) parent?: Ref<Positive>;
  @Prop(() => [ObjectId], { ref: () => Positive }) children?: Ref<Positive>[];
  @Prop(() => String, { ref: () => Tag }) tagRef?: Ref<Tag, string>;
  @Prop(() => UUID, { immutable: true }) uid!: Immutable<UUID>;
  @Prop(() => Date, { default: () => new Date(), immutable: true }) born!: Defaulted<Immutable<Date>>;
  @Prop(() => String, { hidden: true }) secret?: Hidden<string>;
  @Prop(() => String, { nullable: true }) note!: string | null;
  @Prop(() => String, { nullable: true, default: null }) optional!: Defaulted<string | null>;
  @Prop(() => String, { enum: ["a", "b"] }) letter?: "a" | "b";
  @Prop(() => String, { enum: Color }) color?: Color;
  @Prop(() => Number, { enum: [Level.Low, Level.High] }) level?: Level;
  @Prop(() => [String], { enum: ["x", "y"], default: [] }) letters!: Defaulted<("x" | "y")[]>;
  @Prop(() => [Tag]) tags?: Tag[];
  @Prop(() => [[Number]]) matrix?: number[][];
  @Prop(() => Spec.map(Tag)) byName?: Map<string, Tag>;
  @Prop(() => Spec.map([String])) groups?: Map<string, string[]>;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) embedding?: Vector;
  @Prop(() => Spec.binary({ subtype: 5 })) md5?: Binary;
  @Prop(() => Types.Binary) raw?: Binary;
  @Prop(() => Spec.union(String, Number)) either?: string | number;
  @Prop(() => RegExp) pattern?: RegExp;
  @Prop(() => Tag, { excludeIndexes: true }) main?: Tag;
  @Virtual({ ref: () => Tag, localField: "name", foreignField: "label", justOne: true }) firstTag!: VirtualRef<
    Tag,
    true
  >;
  @Virtual({ ref: () => Tag, localField: "name", foreignField: "label", count: true }) tagCount!: VirtualRef<
    Tag,
    false,
    true
  >;

  get display(): Computed<string> {
    return this.name as Computed<string>;
  }

  @Pre("document.save") beforeSave(): void {}
  @Post("document.validate") afterValidate(result: unknown): void {
    void result;
  }
  @PostError("document.save") onError(error: unknown): void {
    void error;
  }
  @Pre(["query.find", "query.findOne"]) scope(this: OperationHookContext<Positive>): void {}
}

@Discriminator("special")
export class PositiveChild extends Positive {
  declare readonly kind: DiscriminatorValue<"special">;
}

const plugin: SchemaPlugin<{ readonly field: string }> = { name: "p", apply: () => undefined };
const bare: SchemaPlugin = { name: "bare", apply: () => undefined };

@Plugin(plugin, { field: "x" })
@Plugin(bare)
@Schema({ nested: true })
export class WithPlugins {
  @Prop(() => String) x?: string;
}

// --- negative: @Prop ------------------------------------------------------------------------------

export class Negative {
  // @ts-expect-error — the type is required (no overload without a thunk)
  @Prop() a0!: string;
  // @ts-expect-error — type: () => String does not produce number
  @Prop(() => String) a1!: number;
  // @ts-expect-error — a literal-union field needs "enum" even when the spec (Number) fits
  @Prop(() => Number) a2!: 1 | 2;
  // @ts-expect-error — a subclass spec on a base-class field (exact class match)
  @Prop(() => Special) a3!: Tag;
  // @ts-expect-error — a base-class spec on a subclass field
  @Prop(() => Tag) a4!: Special;
  // @ts-expect-error — arrays: a scalar spec on an array field
  @Prop(() => String) a5!: string[];
  // @ts-expect-error — unsupported: Set
  @Prop(() => Set) a6!: Set<string>;
  // @ts-expect-error — unsupported: Map without Spec.map
  @Prop(() => Map) a7!: Map<string, number>;
  // @ts-expect-error — default without Defaulted<T>
  @Prop(() => Number, { default: 1 }) b1!: number;
  // @ts-expect-error — Defaulted<T> without default
  @Prop(() => Number) b2!: Defaulted<number>;
  // @ts-expect-error — the default value does not fit the field
  @Prop(() => String, { enum: ["a", "b"], default: "c" }) b3!: Defaulted<"a" | "b">;
  // @ts-expect-error — immutable without Immutable<T>
  @Prop(() => String, { immutable: true }) c1!: string;
  // @ts-expect-error — Immutable<T> without immutable
  @Prop(() => String) c2!: Immutable<string>;
  // @ts-expect-error — hidden without Hidden<T>
  @Prop(() => String, { hidden: true }) c3!: string;
  // @ts-expect-error — Hidden<T> without hidden
  @Prop(() => String) c4!: Hidden<string>;
  // @ts-expect-error — a `| null` field needs nullable: true
  @Prop(() => String) d1!: string | null;
  // @ts-expect-error — nullable on a field without `| null`
  @Prop(() => String, { nullable: true }) d2!: string;
  // @ts-expect-error — default: null on a field that is not nullable
  @Prop(() => String, { default: null }) d3!: Defaulted<string>;
  // @ts-expect-error — enum missing a member
  @Prop(() => String, { enum: ["a"] }) e1!: "a" | "b";
  // @ts-expect-error — enum with an extra member
  @Prop(() => String, { enum: ["a", "b", "c"] }) e2!: "a" | "b";
  // @ts-expect-error — a literal union without enum
  @Prop(() => String) e3!: "a" | "b";
  // @ts-expect-error — enum on a wide string
  @Prop(() => String, { enum: ["a"] }) e4!: string;
  // @ts-expect-error — array elements need the enum too
  @Prop(() => [String]) e5!: ("x" | "y")[];
  // @ts-expect-error — ref: Ref<M> needs ref
  @Prop(() => ObjectId) f1!: Ref<Tag>;
  // @ts-expect-error — ref: another model
  @Prop(() => ObjectId, { ref: () => Special }) f2!: Ref<Tag>;
  // @ts-expect-error — ref on a plain ObjectId field
  @Prop(() => ObjectId, { ref: () => Tag }) f3!: ObjectId;
  // @ts-expect-error — an option of another type (minLength on a number)
  @Prop(() => Number, { minLength: 1 }) g1!: number;
  // @ts-expect-error — expires only on dates
  @Prop(() => String, { expires: 5 }) g2!: string;
  // @ts-expect-error — min of the wrong type for a bigint field
  @Prop(() => BigInt, { min: 0 }) g3!: bigint;
  // @ts-expect-error — a legacy option name is not an option (minlength)
  @Prop(() => String, { minlength: 1 }) g4!: string;
  // @ts-expect-error — a validator receives the field value: string has no toFixed
  @Prop(() => String, { validate: (v) => v.toFixed() === "1" || "x" }) g5!: string;
  // @ts-expect-error — private fields cannot be schema fields
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: the private field is the point of the test.
  @Prop(() => String) private h1!: string;
  // @ts-expect-error — protected fields cannot be schema fields
  @Prop(() => String) protected h2!: string;
  // @ts-expect-error — static fields are not schema fields
  @Prop(() => String) static h3: string;
  // @ts-expect-error — a VirtualRef field is declared with @Virtual
  @Prop(() => ObjectId) h4!: VirtualRef<Tag>;
}

// --- negative: class-level decorators --------------------------------------------------------------

// @ts-expect-error — @Index: "nmae" is not a field of the class (no explicit <T>)
@Index({ nmae: 1 })
@Schema()
export class BadIndex {
  @Prop(() => String) name?: string;
}

// @ts-expect-error — @Index: a partial filter on a missing field, even inside $or
@Index({ name: 1 }, { partialFilterExpression: { $or: [{ nope: 1 }] } })
@Schema()
export class BadPartial {
  @Prop(() => String) name?: string;
}

// @ts-expect-error — @Index: an index on a method is not a field
@Index({ greet: 1 })
@Schema()
export class BadMethodIndex {
  @Prop(() => String) name?: string;
  greet(): string {
    return "";
  }
}

// @ts-expect-error — @Schema: timeseries.timeField must be a Date field
@Schema({ timeseries: { timeField: "name" } })
export class BadTimeField {
  @Prop(() => String) name?: string;
}

// @ts-expect-error — @Schema: discriminatorKey must be a declared string field
@Schema({ discriminatorKey: "kind" })
export class BadKey {
  @Prop(() => String) name?: string;
}

// @ts-expect-error — @Schema: softDelete needs a Date field (default deletedAt)
@Schema({ softDelete: true })
export class BadSoftDelete {
  @Prop(() => String) name?: string;
}

// @ts-expect-error — a schema class must be constructible without arguments
@Schema()
export class NeedsArgs {
  constructor(readonly value: string) {}
}

// @ts-expect-error — a plugin's options are typed: a number is not { field: string }
@Plugin(plugin, { field: 1 })
@Schema()
export class BadPluginOptions {}

// @ts-expect-error — a plugin with required options needs them
@Plugin(plugin)
@Schema()
export class MissingPluginOptions {}

export class BadVirtuals {
  // @ts-expect-error — @Virtual on a field that is not VirtualRef
  @Virtual({ ref: () => Tag, localField: "x", foreignField: "label" }) v1!: Tag[];
  // @ts-expect-error — @Virtual: ref points to another model
  @Virtual({ ref: () => Special, localField: "x", foreignField: "label" }) v2!: VirtualRef<Tag>;
  // @ts-expect-error — @Virtual: justOne differs from VirtualRef<M, true>
  @Virtual({ ref: () => Tag, localField: "x", foreignField: "label" }) v3!: VirtualRef<Tag, true>;
  // @ts-expect-error — @Virtual: foreignField is not a path of the referenced class
  @Virtual({ ref: () => Tag, localField: "x", foreignField: "nope" }) v4!: VirtualRef<Tag>;
  // @ts-expect-error — @Virtual: localField is not a path of this class
  @Virtual({ ref: () => Tag, localField: "nope", foreignField: "label" }) v5!: VirtualRef<Tag>;
  @Prop(() => String) x?: string;
}

export class BadHooks {
  // @ts-expect-error — a query hook must declare `this` (it runs with the operation context)
  @Pre("query.find") implicitThis(): void {}
  // @ts-expect-error — the declared `this` does not match a document event
  @Pre("document.save") wrongThis(this: OperationHookContext<BadHooks>): void {}
  // @ts-expect-error — an unknown event name
  @Pre("save") legacyName(): void {}
  // @ts-expect-error — `updateOne` alone is ambiguous in Mongoose; Typemo needs the scope
  @Post("updateOne") ambiguous(): void {}
}

// @ts-expect-error — @Discriminator on a class whose constructor needs arguments
@Discriminator("x")
export class DiscriminatorArgs extends Tag {
  declare readonly __t: DiscriminatorValue<"x">;
  constructor(readonly v: string) {
    super();
  }
}
