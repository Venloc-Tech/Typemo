/*
 * The types of hydrated documents — typed collections for data fields, the `$`-methods with typed paths, the
 * plain forms and their options — positive and negative.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ClientSession, ObjectId } from "mongodb";
import type {
  DeleteResult,
  HydratedDoc,
  HydratedDocWith,
  Model,
  StrictArray,
  Subdocument,
  SubdocumentArray,
  TypedMap,
} from "../../../src/index.ts";
import type { Address, Line, Order } from "../../fixtures/document/document-entities.ts";

declare const Orders: Model<Order>;
/* an order read with its Hidden `secret` (`select({ "+secret": true })`): the serializations may keep it */
declare const order: HydratedDocWith<Order, { secret?: string }>;
declare const session: ClientSession;

// ---- the fields: typed collections; the entity's own members kept ----------------------------------
expectTypeOf(order.tags).toEqualTypeOf<StrictArray<string>>();
expectTypeOf(order.lines).toEqualTypeOf<SubdocumentArray<Line>>();
expectTypeOf(order.address).toEqualTypeOf<Subdocument<Address> | undefined>();
expectTypeOf(order.notes).toEqualTypeOf<TypedMap<string> | undefined>();
expectTypeOf(order.customer).toEqualTypeOf<string>();
expectTypeOf(order._id).toMatchTypeOf<ObjectId>();
expectTypeOf(order.describe()).toEqualTypeOf<string>();
expectTypeOf(order.label).toMatchTypeOf<string>();
// @ts-expect-error a StrictArray is written through its methods only
order.tags[0] = "x";
// @ts-expect-error a plain array is not a StrictArray: use $set("tags", [...])
order.tags = ["x"];

// ---- results of the model are hydrated documents; lean stays plain ------------------------------------------
const created = Orders.create({ customer: "a", tags: [], lines: [] });
/* a document made from your input keeps its Hidden fields: the values passed are in memory */
expectTypeOf(created).toEqualTypeOf<Promise<HydratedDocWith<Order, { secret?: string }>>>();
/* new(): not saved yet, so the fields of the first write (timestamps, version) are optional until $save */
const fresh = Orders.new({ customer: "a", tags: [], lines: [] });
expectTypeOf(fresh).toEqualTypeOf<
  HydratedDocWith<Order, { secret?: string; createdAt?: Date; updatedAt?: Date; __v?: number }>
>();
expectTypeOf(fresh.createdAt).toEqualTypeOf<Date | undefined>();
/* after $save the document is typed as saved: the first write set them */
const saved = await fresh.$save();
expectTypeOf(saved).toEqualTypeOf<HydratedDocWith<Order, { secret?: string }>>();
expectTypeOf(saved.createdAt).toEqualTypeOf<Date>();
expectTypeOf(saved.__v).toEqualTypeOf<number>();
/* a saved or read document keeps its own type on $save */
expectTypeOf(await order.$save()).toEqualTypeOf<typeof order>();
// @ts-expect-error createdAt is Immutable: an update may not set it
void order.$updateOne({ $set: { createdAt: new Date() } });
// @ts-expect-error createdAt stays Immutable on an unsaved document too (optional, markers kept)
void fresh.$updateOne({ $set: { createdAt: new Date() } });
// @ts-expect-error `customer` is required in the input of new()
Orders.new({ tags: [], lines: [] });
const found = Orders.findById(order._id).orFail();
type Found = Awaited<typeof found>;
expectTypeOf<Found["tags"]>().toEqualTypeOf<StrictArray<string>>();
expectTypeOf<ReturnType<Found["$isNew"]>>().toEqualTypeOf<boolean>();
const lean = Orders.findById(order._id).orFail().lean();
type Leaned = Awaited<typeof lean>;
expectTypeOf<Leaned["tags"]>().toEqualTypeOf<string[]>();
expectTypeOf<Leaned["notes"]>().toEqualTypeOf<{ [key: string]: string } | undefined>();
expectTypeOf(Orders.bulkSave([order])).toMatchTypeOf<Promise<{ insertedCount: number } | undefined>>();

// ---- the $-methods --------------------------------------------------------------------------------------------
expectTypeOf(order.$isNew()).toEqualTypeOf<boolean>();
expectTypeOf(order.$save()).toEqualTypeOf<Promise<typeof order>>();
expectTypeOf(order.$save({ session })).toEqualTypeOf<Promise<typeof order>>();
declare const plainOrder: HydratedDoc<Order>;
expectTypeOf(plainOrder.$save()).toEqualTypeOf<Promise<HydratedDoc<Order>>>();
expectTypeOf(order.$deleteOne()).toEqualTypeOf<Promise<DeleteResult>>();
expectTypeOf(order.$validate()).toEqualTypeOf<Promise<void>>();
expectTypeOf(order.$session()).toEqualTypeOf<ClientSession | undefined>();
expectTypeOf(order.$session(null)).toEqualTypeOf<typeof order>();
expectTypeOf(order.$locals()).toEqualTypeOf<Record<string, unknown>>();
order.$isModified();
order.$isModified("lines.0.qty");
order.$markModified("address.city");
// @ts-expect-error an unknown path
order.$isModified("nope");

// typed paths of $set / $get: fields, subdocument fields, elements by index, Map keys
order.$set("customer", "bob").$set("total", 3);
order.$set("address.city", "Rome");
order.$set("lines.0.qty", 2);
order.$set("tags.1", "b");
order.$set("notes.k", "v");
order.$set("tags", ["a", "b"]);
order.$set("lines", [{ sku: "x", qty: 1 }]);
// @ts-expect-error the value of `total` is a number
order.$set("total", "3");
// @ts-expect-error an unknown path
order.$set("nope", 1);
// @ts-expect-error no positional tokens on a document (it knows its elements)
order.$set("lines.$.qty", 1);
// @ts-expect-error undefined is never a value: delete the field to remove it
order.$set("discount", undefined);
expectTypeOf(order.$get("customer")).toEqualTypeOf<string | undefined>();
expectTypeOf(order.$get("tags")).toEqualTypeOf<StrictArray<string> | undefined>();
expectTypeOf(order.$get("lines.0.qty")).toEqualTypeOf<number | undefined>();

// ---- $toObject / $toJSON: plain, typed by the options ---------------------------------------------------------
const plain = order.$toObject();
expectTypeOf(plain.tags).toEqualTypeOf<string[]>();
expectTypeOf(plain.notes).toEqualTypeOf<Map<string, string> | undefined>(); // Map kept in toObject
expectTypeOf(plain.views).toEqualTypeOf<bigint | undefined>();
expectTypeOf(plain.secret).toEqualTypeOf<string | undefined>(); // loaded Hidden fields are in by default
expectTypeOf<"label" extends keyof typeof plain ? true : false>().toEqualTypeOf<false>();
const noHidden = order.$toObject({ hidden: false });
expectTypeOf<"secret" extends keyof typeof noHidden ? true : false>().toEqualTypeOf<false>();
expectTypeOf(order.$toObject({ virtuals: true }).label).toEqualTypeOf<string>();
expectTypeOf(order.$toObject({ transform: (p) => p.tags.length })).toEqualTypeOf<number>();

const json = order.$toJSON();
expectTypeOf(json._id).toEqualTypeOf<string>();
expectTypeOf(json.createdAt).toEqualTypeOf<string>();
expectTypeOf(json.views).toEqualTypeOf<`${bigint}` | undefined>(); /* int64 → a decimal string, not a number */
expectTypeOf(json.notes).toEqualTypeOf<{ [key: string]: string } | undefined>(); // Map → record
expectTypeOf(json.seenAt).toMatchTypeOf<{ t: number; i: number } | undefined>(); // Timestamp → { t, i }
expectTypeOf(json.blob).toEqualTypeOf<string | undefined>(); // Binary → base64
expectTypeOf(json.pattern).toEqualTypeOf<string | undefined>(); // RegExp → "/src/flags"
expectTypeOf<"secret" extends keyof typeof json ? true : false>().toEqualTypeOf<false>(); // Hidden out by default
expectTypeOf(order.$toJSON({ hidden: true }).secret).toEqualTypeOf<string | undefined>();
expectTypeOf(order.$toJSON({ transform: (j) => j._id })).toEqualTypeOf<string>();
// @ts-expect-error not an option
order.$toObject({ flattenMaps: true });
