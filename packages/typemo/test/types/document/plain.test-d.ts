/*
 * The types of the plain form — `$toPlain(options)` and `.plain(options)` of queries, cursors and aggregations —
 * follow select, populate and discriminators like `lean()`, then map every value by the ONE table (`PlainValue`).
 * Positive: `expectTypeOf` / the exact contract check; negative: `@ts-expect-error` with the reason.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { Binary, ObjectId, Timestamp } from "mongodb";
import { type ContractCheck, Entity, type Model, Prop, Schema, Spec, Types, type Vector } from "../../../src/index.ts";
import type { AllForms, Holder, Pulse, Vault } from "../../fixtures/document/plain-entities.ts";

declare const All: Model<AllForms>;
declare const Holders: Model<Holder>;
declare const Pulses: Model<Pulse>;
declare const Vaults: Model<Vault>;
declare const id: ObjectId;
declare const doc: Awaited<ReturnType<typeof readAll>>;
const readAll = () => All.findById(id).select({ "+secret": true }).orFail();

// ---- $toPlain(): every BSON type ------------------------------------------------------------------------
const plain = doc.$toPlain();
expectTypeOf(plain._id).toEqualTypeOf<string>();
expectTypeOf(plain.long).toEqualTypeOf<`${bigint}` | undefined>();
expectTypeOf(plain.dec).toEqualTypeOf<string | undefined>();
expectTypeOf(plain.uuid).toEqualTypeOf<string | undefined>();
expectTypeOf(plain.date).toEqualTypeOf<Date | undefined>();
expectTypeOf(plain.re).toEqualTypeOf<RegExp | undefined>();
expectTypeOf(plain.bin).toEqualTypeOf<Uint8Array<ArrayBuffer> | undefined>();
expectTypeOf(plain.vInt8).toEqualTypeOf<number[] | undefined>();
expectTypeOf(plain.vBits).toEqualTypeOf<number[] | undefined>();
expectTypeOf(plain.ts).toEqualTypeOf<{ t: number; i: number } | undefined>();
expectTypeOf(plain.nil).toEqualTypeOf<string | null | undefined>();
expectTypeOf(plain.grid).toEqualTypeOf<`${bigint}`[][]>();
expectTypeOf(plain.spots).toEqualTypeOf<{ x: number; weight?: `${bigint}`; marker?: string }[]>();
expectTypeOf(plain.spotsByName).toEqualTypeOf<
  Map<string, { x: number; weight?: `${bigint}`; marker?: string }> | undefined
>();
expectTypeOf(plain.prices).toEqualTypeOf<Map<string, string> | undefined>();
expectTypeOf(plain.owner).toEqualTypeOf<string | undefined>();
expectTypeOf(plain.holdersByRole).toEqualTypeOf<Map<string, string> | undefined>();
// Hidden: out by default, in with { hidden: true }; getter virtuals with { virtuals: true }
expectTypeOf<"secret" extends keyof typeof plain ? true : false>().toEqualTypeOf<false>();
expectTypeOf(doc.$toPlain({ hidden: true }).secret).toEqualTypeOf<string | undefined>();
expectTypeOf(doc.$toPlain({ virtuals: true }).summary).toEqualTypeOf<string>();
expectTypeOf(doc.$toPlain({ transform: (row) => row.long })).toEqualTypeOf<`${bigint}` | undefined>();

// ---- .plain(): the same type as $toPlain() of the hydrated document -------------------------------------
declare const rows: Awaited<ReturnType<typeof readRows>>;
const readRows = () => All.findById(id).select({ "+secret": true }).orFail().plain();
expectTypeOf<ContractCheck<typeof rows, typeof plain>>().toEqualTypeOf<true>();
declare const hiddenRows: Awaited<ReturnType<typeof readHidden>>;
const readHidden = () => All.findById(id).select({ "+secret": true }).orFail().plain({ hidden: true });
expectTypeOf<
  ContractCheck<typeof hiddenRows, ReturnType<typeof doc.$toPlain<{ hidden: true }>>>
>().toEqualTypeOf<true>();
// lists, one or null, cursors
expectTypeOf(Holders.find().plain()).resolves.toEqualTypeOf<
  {
    _id: string;
    name: string;
    score?: `${bigint}`;
    spots?: Map<string, { x: number; weight?: `${bigint}`; marker?: string }>;
    boss?: string;
  }[]
>();
expectTypeOf(Holders.findOne().select({ name: 1 }).plain()).resolves.toEqualTypeOf<{
  name: string;
  _id: string;
} | null>();
expectTypeOf(Holders.find().select({ name: 1, _id: 0 }).plain().cursor().next()).resolves.toEqualTypeOf<{
  name: string;
} | null>();
// populate: the populated documents in their plain form, nested
declare const populated: Awaited<ReturnType<typeof readPopulated>>;
const readPopulated = () =>
  All.findById(id)
    .select({ owner: 1 })
    .populate({ path: "owner", select: { name: 1, boss: 1 }, populate: { path: "boss", select: { score: 1 } } })
    .orFail()
    .plain();
expectTypeOf(populated.owner).toEqualTypeOf<
  { _id: string; name: string; boss?: { score?: `${bigint}`; _id: string } | null } | null | undefined
>();
// a discriminator's own fields
expectTypeOf(Pulses.findOne().orFail().plain()).resolves.toHaveProperty("energy").toEqualTypeOf<`${bigint}`>();
// aggregate: the row type by the table
expectTypeOf(All.aggregate((p) => p.project({ long: 1, owner: 1, _id: 0 })).plain()).resolves.toEqualTypeOf<
  { long?: `${bigint}`; owner?: string }[]
>();

// ---- Hidden fields out at every depth unless { hidden: true } -----------------------------------------
declare const vault: Awaited<ReturnType<typeof readVault>>;
const readVault = () =>
  Vaults.findById(id)
    .select({ "+main.code": true, "+lockers.code": true })
    .populate({ path: "keeper", select: { name: 1, pin: 1 } })
    .orFail();
type Keeper = { _id: string; name: string };
type KeeperWithPin = { _id: string; name: string; pin?: string };
const vPlain = vault.$toPlain();
expectTypeOf(vPlain.main).toEqualTypeOf<{ label: string } | undefined>();
expectTypeOf(vPlain.lockers).toEqualTypeOf<{ label: string }[]>();
expectTypeOf(vPlain.byRoom).toEqualTypeOf<Map<string, { label: string }> | undefined>();
expectTypeOf(vPlain.keeper).toEqualTypeOf<Keeper | null | undefined>();
const vPlainHidden = vault.$toPlain({ hidden: true });
expectTypeOf(vPlainHidden.main).toEqualTypeOf<{ label: string; code?: string } | undefined>();
expectTypeOf(vPlainHidden.lockers).toEqualTypeOf<{ label: string; code?: string }[]>();
expectTypeOf(vPlainHidden.byRoom).toEqualTypeOf<Map<string, { label: string; code?: string }> | undefined>();
expectTypeOf(vPlainHidden.keeper).toEqualTypeOf<KeeperWithPin | null | undefined>();
const vJson = vault.$toJSON();
expectTypeOf(vJson.main).toEqualTypeOf<{ label: string } | undefined>();
expectTypeOf(vJson.byRoom).toEqualTypeOf<{ [key: string]: { label: string } } | undefined>();
expectTypeOf<"pin" extends keyof NonNullable<typeof vJson.keeper> ? true : false>().toEqualTypeOf<false>();
expectTypeOf(vault.$toJSON({ hidden: true }).lockers).toEqualTypeOf<{ label: string; code?: string }[]>();
declare const vRows: Awaited<ReturnType<typeof readVaultRows>>;
const readVaultRows = () => readVault().plain();
expectTypeOf<ContractCheck<typeof vRows, typeof vPlain>>().toEqualTypeOf<true>();
declare const vRowsHidden: Awaited<ReturnType<typeof readVaultRowsHidden>>;
const readVaultRowsHidden = () => readVault().plain({ hidden: true });
expectTypeOf<ContractCheck<typeof vRowsHidden, typeof vPlainHidden>>().toEqualTypeOf<true>();
// $toObject(): Hidden fields in by default, out at every depth with { hidden: false } (the same serializer)
expectTypeOf(vault.$toObject().main).toEqualTypeOf<{ label: string; code?: string } | undefined>();
expectTypeOf(vault.$toObject({ hidden: false }).main).toEqualTypeOf<{ label: string } | undefined>();
// @ts-expect-error — a Hidden field of a subdocument is out of $toPlain() without { hidden: true }
vPlain.main?.code;
// @ts-expect-error — a Hidden field of an array element is out of $toJSON() without { hidden: true }
vJson.lockers[0]?.code;
// @ts-expect-error — the Hidden field of a populated document (selected with +pin) is out of .plain()
vRows.keeper?.pin;

// ---- a Long field takes a decimal integer string (`${bigint}`) in create, updates and filters ------------
Holders.create({ name: "n", score: "9223372036854775807" });
Holders.create({ name: "n", score: -5n });
Holders.updateOne({ name: "n" }, { $set: { score: "-42" } });
Holders.find({ score: "42" });
Holders.find({ score: { $gt: "42", $in: ["1", 2n] } });
// @ts-expect-error — "1.5" is not a decimal integer
Holders.create({ name: "n", score: "1.5" });
// @ts-expect-error — a leading zero is not the decimal form of an int64
Holders.create({ name: "n", score: "01" });
// @ts-expect-error — an unchecked `string` is not an int64 string (validate it first)
Holders.create({ name: "n", score: String(1) });
// The plain / JSON type of int64 is `${bigint}` (Int64String), so it goes back into create() without a cast
Holders.create({ name: "n", score: doc.$toPlain().long ?? "0" });
Holders.create({ name: "n", score: doc.$toJSON().long ?? "0" });
expectTypeOf(plain.long).toEqualTypeOf<`${bigint}` | undefined>();
// @ts-expect-error — numeric strings are for int64 only: an Int32 field does not take a numeric string
All.updateOne({ str: "a" }, { $set: { i32: "42" } });
// @ts-expect-error — numeric strings are for int64 only: a filter on an Int32 field does not take a numeric string
All.find({ i32: "42" });

// ---- negative cases ------------------------------------------------------------------------------------
// @ts-expect-error — a plain int64 is a decimal string, never a bigint (JSON.stringify would throw on one)
export const notBigint: bigint | undefined = plain.long;
// @ts-expect-error — a plain id is a string, not an ObjectId
export const notObjectId: ObjectId = plain._id;
// @ts-expect-error — a plain vector is its values, not a Binary
export const notBinary: Binary | undefined = plain.vInt8;
// @ts-expect-error — the plain Timestamp is { t, i }, not the BSON class
export const notTimestamp: Timestamp | undefined = plain.ts;
// @ts-expect-error — a plain row is not a document: no $save
rows.$save();
// @ts-expect-error — .plain() takes { hidden } only (no virtuals: nothing is hydrated)
All.find().plain({ virtuals: true });
// @ts-expect-error — the Hidden field is out of .plain() without { hidden: true }
rows.secret;

// ---- Vector: a vector field is declared `Vector`, a binary one is not -----------------------------
@Schema()
export class Embedded {
  @Prop(() => Spec.vector({ dtype: "float32" }))
  vector?: Vector;

  @Prop(() => Types.Binary)
  bytes?: Binary;
}

@Schema()
export class WrongVector extends Entity {
  // @ts-expect-error — Spec.vector(...) needs the field type Vector (its plain/JSON forms are number[])
  @Prop(() => Spec.vector({ dtype: "int8" }))
  vector?: Binary;
}

@Schema()
export class WrongBinary extends Entity {
  // @ts-expect-error — a Vector field needs Spec.vector({ dtype, dimensions })
  @Prop(() => Types.Binary)
  bytes?: Vector;
}
