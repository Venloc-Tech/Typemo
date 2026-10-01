/*
 * `populate({ path, required: true })` removes `| null` from the result type (like `orFail`); `clone` does not
 * change the type. `__t` of a discriminator is in the lean type as the literal of its value when the class
 * declares it (`DiscriminatorValue<"…">`), and `@Discriminator` checks it.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Lean,
  type ModelOperations,
  Prop,
  Schema,
} from "../../../src/index.ts";
import type { Person } from "../../fixtures/populate/populate-entities.ts";

declare const People: ModelOperations<Person>;

type CompanyLean = { _id: ObjectId; name: string; size?: number };
type PostLean = { _id: ObjectId; title: string; author: import("../../../src/index.ts").Ref<Person>; tags: unknown };

// ---- required populate -------------------------------------------------------------------------------------------
const matched = () =>
  People.findOne()
    .populate({ path: "company", match: { size: { $gt: 1 } } })
    .orFail()
    .lean();
expectTypeOf<Awaited<ReturnType<typeof matched>>["company"]>().toEqualTypeOf<CompanyLean | null | undefined>();

const required = () =>
  People.findOne()
    .populate({ path: "company", match: { size: { $gt: 1 } }, required: true })
    .orFail()
    .lean();
// `required`: no `| null` (the field's own optionality stays: an absent reference is not populated).
expectTypeOf<Awaited<ReturnType<typeof required>>["company"]>().toEqualTypeOf<CompanyLean | undefined>();

const topPost = () => People.findOne().populate("topPost").orFail().lean();
expectTypeOf<Awaited<ReturnType<typeof topPost>>["topPost"]>().toExtend<object | null | undefined>();
expectTypeOf<null>().toExtend<Awaited<ReturnType<typeof topPost>>["topPost"]>();
const topPostRequired = () => People.findOne().populate({ path: "topPost", required: true }).orFail().lean();
// @ts-expect-error — `null` is no longer a possible value of a required justOne virtual
expectTypeOf<null>().toExtend<Awaited<ReturnType<typeof topPostRequired>>["topPost"]>();

const cloned = () => People.findOne().populate({ path: "company", clone: true }).orFail().lean();
expectTypeOf<Awaited<ReturnType<typeof cloned>>["company"]>().toEqualTypeOf<CompanyLean | null | undefined>();
const clonedRequired = () => People.findOne().populate({ path: "company", required: true }).orFail().lean();
expectTypeOf<Awaited<ReturnType<typeof clonedRequired>>["company"]>().toEqualTypeOf<CompanyLean | undefined>();
// @ts-expect-error — `required: true`: a single reference that finds nothing is an error, so no `null`
expectTypeOf<null>().toExtend<Awaited<ReturnType<typeof clonedRequired>>["company"]>();

// @ts-expect-error — `required` is a boolean
People.findOne().populate({ path: "company", required: "yes" });

void ({} as PostLean);

// ---- discriminator key -------------------------------------------------------------------------------------------
@Schema({ collection: "l4_shapes" })
class Shape extends Entity {
  @Prop(() => String) label?: string;
}

@Discriminator("circle")
class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true }) radius!: number;
}

expectTypeOf<Lean<Circle>["__t"]>().toEqualTypeOf<"circle">();
expectTypeOf<Lean<Circle>>().toEqualTypeOf<{ _id: ObjectId; label?: string; __t: "circle"; radius: number }>();
declare const Circles: ModelOperations<Circle>;
// Optional on create (the core writes it) …
Circles.find({ __t: "circle" });
// @ts-expect-error — … and not writable by an update (immutable)
Circles.updateOne({ radius: 1 }, { $set: { __t: "circle" } });

// @ts-expect-error — the declared literal must be the decorator's value
@Discriminator("square")
class Square extends Shape {
  declare readonly __t: DiscriminatorValue<"sq">;
  @Prop(() => Number, { required: true }) side!: number;
}

// @ts-expect-error — a declared key needs the value given explicitly (the default, the class name, is not a literal)
@Discriminator()
class Triangle extends Shape {
  declare readonly __t: DiscriminatorValue<"Triangle">;
}

// The declaration is mandatory (the error cases are in types/schema/discriminator-value.test-d.ts).
@Discriminator("plain")
class Plain extends Shape {
  declare readonly __t: DiscriminatorValue<"plain">;
}

void [Square, Triangle, Plain];
