/*
 * The types of the model's operations (the statics of the old wrapper's TypedModel), results, cursors, errors,
 * the client and instrumentation — positive and negative.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ClientSession, ObjectId } from "mongodb";
import {
  type AggregateQuery,
  type BulkWriteResult,
  type ChangeEvent,
  type Connection,
  type DuplicateKeyError,
  Entity,
  ErrorClassifier,
  fn,
  type HydratedDoc,
  type HydratedDocWith,
  type InstrumentationEvent,
  type Model,
  type ModelChangeStream,
  Prop,
  type QueryCursor,
  Schema,
  type ServerError,
  Timestamped,
  type TransactionScope,
  TypemoClient,
  type UpdateResult,
  untrusted,
  Versioned,
} from "../../../src/internal.ts";
import type { Order, Person } from "../../fixtures/model/model-entities.ts";

declare const connection: Connection;
declare const People: Model<Person>;
declare const Orders: Model<Order>;
declare const id: ObjectId;

// ---- the model and its registry ----------------------------------------------------------------
expectTypeOf(connection.model<Person>).returns.toEqualTypeOf<Model<Person>>();
expectTypeOf(People.entity).toEqualTypeOf<Model<Person>["entity"]>();

// ---- inserts: the created document (hydrated), CreateInput checked --------------------------------
const created = People.create({ name: "A", email: "a", tags: [], pets: [], lastSeen: null });
/* the created document: made from your input, so its Hidden field is listed */
expectTypeOf(created).toEqualTypeOf<Promise<HydratedDocWith<Person, { secret?: string }>>>();
const many = People.create([{ name: "A", email: "a", tags: [], pets: [], lastSeen: null }]);
expectTypeOf(many).toEqualTypeOf<Promise<HydratedDocWith<Person, { secret?: string }>[]>>();
expectTypeOf(People.insertMany([], { ordered: false })).toEqualTypeOf<
  Promise<HydratedDocWith<Person, { secret?: string }>[]>
>();
expectTypeOf(People.insertOne({ name: "A", email: "a", tags: [], pets: [], lastSeen: null })).toEqualTypeOf<
  Promise<HydratedDocWith<Person, { secret?: string }>>
>();
expectTypeOf(People.new({ name: "A", email: "a", tags: [], pets: [], lastSeen: null })).toEqualTypeOf<
  HydratedDocWith<Person, { secret?: string }>
>();

// ---- the Hidden field of a created document: readable, kept by $toObject, left out of $toPlain/$toJSON ----
declare const createdPerson: Awaited<typeof created>;
expectTypeOf(createdPerson.secret).toEqualTypeOf<string | undefined>();
expectTypeOf(createdPerson.$toObject().secret).toEqualTypeOf<string | undefined>();
// @ts-expect-error $toPlain() leaves Hidden fields out, also for a created document
createdPerson.$toPlain().secret;
// @ts-expect-error $toJSON() leaves Hidden fields out, also for a created document
createdPerson.$toJSON().secret;
expectTypeOf(createdPerson.$toPlain({ hidden: true }).secret).toEqualTypeOf<string | undefined>();
/* a created document still goes where a read one is taken */
const takesPerson = (person: HydratedDoc<Person>): string => person.name;
takesPerson(createdPerson);
// @ts-expect-error a read still leaves the Hidden field out: only the documents made from input list it
(await People.findOne({ name: "A" }).orFail()).secret;

// @ts-expect-error `email` is required in the create input
People.create({ name: "A", tags: [], pets: [], lastSeen: null });
// @ts-expect-error an unknown field in the create input
People.insertOne({ name: "A", email: "a", tags: [], pets: [], lastSeen: null, nmae: "x" });
// @ts-expect-error `ordered` is not an option of create (always ordered)
People.create([], { ordered: false });

// ---- bulkWrite: operations typed by the entity, ids by `_id` -----------------------------------------
const bulk = People.bulkWrite([
  { insertOne: { document: { name: "A", email: "a", tags: [], pets: [], lastSeen: null } } },
  { updateOne: { filter: { name: "A" }, update: { $set: { age: 1 } }, upsert: true } },
  { deleteMany: { filter: { age: { $lt: 0 } } } },
]);
expectTypeOf(bulk).toEqualTypeOf<Promise<BulkWriteResult<ObjectId>>>();
// @ts-expect-error a filter on an unknown path
People.bulkWrite([{ deleteOne: { filter: { nmae: "x" } } }]);
// @ts-expect-error an update of the wrong type
People.bulkWrite([{ updateOne: { filter: {}, update: { $set: { age: "x" } } } }]);

// an update pipeline (the pipeline builder's update mode) is an update of bulkWrite, as in updateOne
People.bulkWrite([
  { updateOne: { filter: { name: "A" }, update: (p) => p.set(() => ({ age: 2 })), upsert: false } },
  { updateMany: { filter: { name: "B" }, update: (p) => p.set(() => ({ age: 3 })) } },
]);
// @ts-expect-error the callback must add a stage (an empty pipeline is not an update)
People.bulkWrite([{ updateOne: { filter: { name: "A" }, update: (p) => p } }]);
// @ts-expect-error an array of stages is not an update (the pipeline is built with the pipeline builder)
People.bulkWrite([{ updateOne: { filter: { name: "A" }, update: [{ $set: { age: 1 } }] } }]);

// ---- find-and-modify by id ----------------------------------------------------------------------------
const byId = People.findByIdAndUpdate(id, { $set: { age: 3 } }).lean();
expectTypeOf<Awaited<typeof byId>>().toMatchTypeOf<{ name: string } | null>();
const upserted = People.findByIdAndUpdate(id, { $set: { age: 3 } }, { upsert: true }).lean();
expectTypeOf<null extends Awaited<typeof upserted> ? true : false>().toEqualTypeOf<false>();
/* the id is typed by `_id`: an ObjectId or its hex string (the plain form accepted back) */
People.findByIdAndDelete("5f8d0d55b54764421b7156c3");
// @ts-expect-error an ObjectId `_id` takes no number
People.findByIdAndDelete(42);
expectTypeOf(People.updateOne({ name: "a" }, { $set: { age: 1 } }).exec()).toEqualTypeOf<
  Promise<UpdateResult<ObjectId>>
>();

// ---- aggregate: rows from the builder --------------------------------------------------------------
const grouped = People.aggregate((p) => p.group((f) => ({ _id: f.role, total: fn.sum(f.age) })));
expectTypeOf(grouped).toEqualTypeOf<AggregateQuery<{ _id: "user" | "admin"; total: number }>>();
expectTypeOf<Awaited<typeof grouped>>().toEqualTypeOf<{ _id: "user" | "admin"; total: number }[]>();
expectTypeOf(grouped.cursor()).toEqualTypeOf<QueryCursor<{ _id: "user" | "admin"; total: number }>>();
const joined = Orders.aggregate((p) => p.match({ total: { $gt: 0 } }).project(() => ({ total: 1, _id: 0 })));
expectTypeOf<Awaited<typeof joined>[number]>().toEqualTypeOf<{ total: number }>();
// @ts-expect-error a `$match` on an unknown path of the stored document
People.aggregate((p) => p.match({ nmae: "x" }));

// ---- cursors: typed documents, typed map --------------------------------------------------------------
const cursor = People.find().lean().cursor();
expectTypeOf(cursor.next()).resolves.toMatchTypeOf<{ name: string } | null>();
const names = cursor.map((doc) => doc.name);
expectTypeOf(names).toEqualTypeOf<QueryCursor<string>>();
cursor.eachAsync((doc, index) => {
  expectTypeOf(doc.name).toEqualTypeOf<string>();
  expectTypeOf(index).toEqualTypeOf<number>();
});
cursor.eachAsync(
  (docs, batch) => {
    expectTypeOf(docs[0]?.name).toEqualTypeOf<string | undefined>();
    expectTypeOf(batch).toEqualTypeOf<number>();
  },
  { batchSize: 10, parallel: 2 },
);

// ---- change streams ----------------------------------------------------------------------------------
const stream = People.watch();
// The stream is typed by its events (a union by operation type, see test/types/mechanisms).
expectTypeOf(stream).toEqualTypeOf<Promise<ModelChangeStream<ChangeEvent<Person>>>>();
expectTypeOf<Extract<ChangeEvent<Person>, { operationType: "delete" }>["documentKey"]>().toEqualTypeOf<{
  readonly _id: ObjectId;
}>();

// ---- sessions and transactions --------------------------------------------------------------------
declare const client: TypemoClient;
const result = client.transaction(async (scope) => {
  expectTypeOf(scope).toEqualTypeOf<TransactionScope>();
  expectTypeOf(scope.session).toEqualTypeOf<ClientSession>();
  return 42 as const;
});
expectTypeOf(result).toEqualTypeOf<Promise<42>>();
People.find().session(null); /* explicitly outside the ambient transaction */
People.create({ name: "A", email: "a", tags: [], pets: [], lastSeen: null }, { session: null });
// @ts-expect-error a legacy timeout option is not a client option (timeoutMS only)
new TypemoClient("mongodb://h", { socketTimeoutMS: 5 });

// ---- errors and instrumentation -------------------------------------------------------------------
declare const caught: unknown;
if (ErrorClassifier.isDuplicateKey(caught)) {
  expectTypeOf(caught).toEqualTypeOf<DuplicateKeyError>();
  expectTypeOf(caught.keyValue).toEqualTypeOf<Readonly<Record<string, unknown>> | undefined>();
  expectTypeOf(caught).toMatchTypeOf<ServerError>();
}
declare const event: InstrumentationEvent;
if (event.type === "operation.error") expectTypeOf(event.classification.retryable).toEqualTypeOf<boolean>();
if (event.type === "driver.command.started") expectTypeOf(event.operationId).toEqualTypeOf<number | undefined>();

// ---- exec({ force }) on every builder that caches or runs once ------------------------------------
expectTypeOf(People.find().exec({ force: true })).toEqualTypeOf(People.find().exec());
expectTypeOf(People.countDocuments().exec({ force: true })).toEqualTypeOf<Promise<number>>();
expectTypeOf(People.updateOne({ name: "A" }, { $set: { age: 1 } }).exec({ force: true })).toEqualTypeOf<
  Promise<UpdateResult<ObjectId>>
>();
People.aggregate((p) => p.match({ name: "A" })).exec({ force: false });
People.distinct("name").exec({ force: true });
People.exists({ name: "A" }).exec({ force: true });
// @ts-expect-error `force` is a boolean
People.find().exec({ force: 1 });
// @ts-expect-error `exec` has no other options
People.find().exec({ again: true });

// ---- untrusted(value) keeps the value's type --------------------------------------------------------
People.find({ name: untrusted("x") });
expectTypeOf(untrusted({ a: 1 })).toEqualTypeOf<{ readonly a: 1 }>();
declare const requestValue: unknown;
// @ts-expect-error untrusted() does not validate: unknown request data must be validated to a string first
People.find({ name: untrusted(requestValue) });

// ---- a replacement takes no service fields ------------------------------------------------------------
@Schema({ collection: "td_notes" })
class TypedNote extends Versioned(Timestamped(Entity)) {
  @Prop(() => String, { required: true })
  title!: string;
}
declare const Notes: Model<TypedNote>;
Notes.replaceOne({ title: "a" }, { title: "b" });
Notes.findOneAndReplace({ title: "a" }, { title: "b" }, { upsert: true });
// @ts-expect-error createdAt is kept by the core: not part of a replacement
Notes.replaceOne({ title: "a" }, { title: "b", createdAt: new Date() });
// @ts-expect-error __v is kept by the core
Notes.findOneAndReplace({ title: "a" }, { title: "b", __v: 1 });
// @ts-expect-error updatedAt is bumped by the core
Notes.replaceOne({ title: "a" }, { title: "b", updatedAt: new Date() });
