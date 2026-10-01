/*
 * A populated single reference is `null` when the referenced document is gone (or `match` left it out):
 * its type always includes `null`, `required: true` removes it. `isPresent` narrows every form (hydrated, lean,
 * plain, populated) and works with `.filter(isPresent)`.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import { type HydratedDoc, isPresent, type ModelOperations } from "../../../src/index.ts";
import type { Person } from "../../fixtures/populate/populate-entities.ts";

declare const People: ModelOperations<Person>;

type CompanyLean = { _id: ObjectId; name: string; size?: number };

/* lean: `null` possible, removed by `required: true` */
declare const lean: Awaited<ReturnType<typeof readLean>>;
const readLean = () => People.findOne().populate("company").orFail().lean();
expectTypeOf(lean.company).toEqualTypeOf<CompanyLean | null | undefined>();
declare const required: Awaited<ReturnType<typeof readRequired>>;
const readRequired = () => People.findOne().populate({ path: "company", required: true }).orFail().lean();
expectTypeOf(required.company).toEqualTypeOf<CompanyLean | undefined>();
// @ts-expect-error — without `required`, the company may be gone: `null` must be handled first
lean.company.name;

/* isPresent narrows lean, hydrated and plain forms */
if (isPresent(lean.company)) expectTypeOf(lean.company).toEqualTypeOf<CompanyLean>();
declare const hydrated: Awaited<ReturnType<typeof readHydrated>>;
const readHydrated = () => People.findOne().populate("company").orFail();
if (isPresent(hydrated.company)) expectTypeOf(hydrated.company.name).toEqualTypeOf<string>();
declare const plain: Awaited<ReturnType<typeof readPlain>>;
const readPlain = () => People.findOne().populate("company").orFail().plain();
if (isPresent(plain.company)) expectTypeOf(plain.company._id).toEqualTypeOf<string>();

/* a document (or null) itself */
declare const maybe: HydratedDoc<Person> | null;
if (isPresent(maybe)) expectTypeOf(maybe).toEqualTypeOf<HydratedDoc<Person>>();

/* .filter(isPresent) over retainNullValues */
declare const retained: Awaited<ReturnType<typeof readRetained>>;
const readRetained = () => People.findOne().populate({ path: "friends", retainNullValues: true }).orFail().lean();
expectTypeOf(retained.friends.filter(isPresent)).toEqualTypeOf<NonNullable<(typeof retained.friends)[number]>[]>();

/* the same path twice in a populate list: a compile error (the runtime refuses it with a QueryError) */
// @ts-expect-error — "company" is given twice (string form)
People.findOne().populate(["company", "company"]);
// @ts-expect-error — "company" is given twice (string and object form)
People.findOne().populate(["company", { path: "company", select: { name: 1 } }]);
// @ts-expect-error — "company" is given twice inside a nested populate list
People.findOne().populate({ path: "mentor", populate: ["company", { path: "company" }] });
/* different paths, and the same leaf under different parents, are fine */
People.findOne().populate(["company", "friends"]);
People.findOne().populate(["company", "mentor.company"]);
