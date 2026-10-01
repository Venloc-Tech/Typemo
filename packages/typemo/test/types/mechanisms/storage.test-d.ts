/*
 * Types of the storage APIs: change events per operation type and per options, the watch overloads, keyset sort
 * keys, view and materialized row checks, collection options, the testing entry point — positive and negative
 * (each @ts-expect-error says what must fail).
 */

import { defineFactory, type IndexUsage } from "@venloc/typemo/testing";
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import {
  type ChangeEvent,
  type Connection,
  type EnsureCollectionReport,
  Entity,
  type EventDoc,
  type EventOf,
  Filters,
  fn,
  type HydratedDoc,
  type KeysetKey,
  type KeysetPage,
  Materialized,
  type Model,
  type ModelChangeStream,
  type NoNarrowing,
  Prop,
  type ResultDoc,
  Schema,
  type SyncReport,
  TypedView,
} from "../../../src/index.ts";
import {
  type Animal,
  Article,
  type Dog,
  type Imaged,
  StateTotal,
  TitleScore,
  TopArticle,
} from "../../fixtures/mechanisms/storage-entities.ts";

declare const connection: Connection;
declare const Imageds: Model<Imaged>;
declare const Animals: Model<Animal>;
declare const Dogs: Model<Dog>;
declare const Articles: Model<Article>;

// ---- event documents: the same form as find() / find().lean() -----------------------------------------
expectTypeOf<EventDoc<Animal, Record<never, never>>>().toEqualTypeOf<
  ResultDoc<Animal, undefined, never, true, NoNarrowing, never>
>();
expectTypeOf<EventDoc<Animal, { hydrate: true }>>().toEqualTypeOf<
  ResultDoc<Animal, undefined, never, false, NoNarrowing, never>
>();
// A Hidden field is not in an event document (removed on the server).
expectTypeOf<EventDoc<Animal, Record<never, never>>>().not.toHaveProperty("secret");

// ---- events per operation type and per options ---------------------------------------------------------
type Lean = EventDoc<Imaged, Record<never, never>>;
expectTypeOf<EventOf<Imaged, "insert">["fullDocument"]>().toEqualTypeOf<Lean>();
expectTypeOf<EventOf<Imaged, "insert">["documentKey"]>().toEqualTypeOf<{ readonly _id: ObjectId }>();
expectTypeOf<EventOf<Imaged, "update">["fullDocument"]>().toEqualTypeOf<undefined>();
expectTypeOf<
  EventOf<Imaged, "update", { fullDocument: "updateLookup" }>["fullDocument"]
>().toEqualTypeOf<Lean | null>();
expectTypeOf<EventOf<Imaged, "update", { fullDocument: "required" }>["fullDocument"]>().toEqualTypeOf<Lean>();
expectTypeOf<EventOf<Imaged, "delete">["fullDocumentBeforeChange"]>().toEqualTypeOf<undefined>();
expectTypeOf<
  EventOf<Imaged, "delete", { fullDocumentBeforeChange: "whenAvailable" }>["fullDocumentBeforeChange"]
>().toEqualTypeOf<Lean | null>();
expectTypeOf<
  EventOf<Imaged, "replace", { fullDocumentBeforeChange: "required"; hydrate: true }>["fullDocumentBeforeChange"]
>().toEqualTypeOf<HydratedDoc<Imaged>>();
expectTypeOf<EventOf<Imaged, "update">["updateDescription"]["updatedFields"]>().toEqualTypeOf<
  Readonly<Record<string, unknown>>
>();
// @ts-expect-error a delete event has no fullDocument
type _NoFull = EventOf<Imaged, "delete">["fullDocument"];

// ---- watch overloads ----------------------------------------------------------------------------------
expectTypeOf(Imageds.watch()).toEqualTypeOf<Promise<ModelChangeStream<ChangeEvent<Imaged>>>>();
// The options are inferred as written (const) and type the events: a hydrated, required post-image.
export const hydrated: Promise<
  ModelChangeStream<ChangeEvent<Imaged, { readonly hydrate: true; readonly fullDocument: "required" }>>
> = Imageds.watch({ hydrate: true, fullDocument: "required" });
expectTypeOf<
  EventOf<Imaged, "update", { readonly hydrate: true; readonly fullDocument: "required" }>["fullDocument"]
>().toEqualTypeOf<HydratedDoc<Imaged>>();
// $match keeps the typed events; a reshaping stage gives the pipeline's rows.
expectTypeOf(Imageds.watch((p) => p.match({ operationType: "insert" }))).toEqualTypeOf<
  Promise<ModelChangeStream<ChangeEvent<Imaged>>>
>();
const projected = Imageds.watch((p) => p.project({ operationType: 1 }));
expectTypeOf<Awaited<typeof projected>>().not.toEqualTypeOf<ModelChangeStream<ChangeEvent<Imaged>>>();
// The discriminator model's events are typed by the discriminator class.
expectTypeOf(Dogs.watch()).toEqualTypeOf<Promise<ModelChangeStream<ChangeEvent<Dog>>>>();
expectTypeOf(Animals.watch()).toEqualTypeOf<Promise<ModelChangeStream<ChangeEvent<Animal>>>>();
// @ts-expect-error not a value of fullDocument
Imageds.watch({ fullDocument: "always" });
// @ts-expect-error an unknown option
Imageds.watch({ resumeToken: "x" });
// Awaiting the stream type does not exceed the instantiation depth (an intersection form did: TS2589).
type Awaited1 = Awaited<Promise<ModelChangeStream<ChangeEvent<Imaged>>>>;
expectTypeOf<Awaited1>().toEqualTypeOf<ModelChangeStream<ChangeEvent<Imaged>>>();

// ---- keyset pagination --------------------------------------------------------------------------------
expectTypeOf<KeysetKey<Article>>().toEqualTypeOf<"_id" | "title" | "publishedAt" | "score" | "views" | "state">();
const leanPage = Articles.keysetPage({ sort: [["publishedAt", -1]], limit: 10, lean: true });
expectTypeOf(leanPage).toEqualTypeOf<
  Promise<KeysetPage<ResultDoc<Article, undefined, never, true, NoNarrowing, never>>>
>();
const hydratedPage = Articles.keysetPage({
  sort: [
    ["score", 1],
    ["publishedAt", "desc"],
  ],
  limit: 10,
  after: null,
});
expectTypeOf(hydratedPage).toEqualTypeOf<
  Promise<KeysetPage<ResultDoc<Article, undefined, never, false, NoNarrowing, never>>>
>();
// @ts-expect-error a nullable field cannot be a sort key (a missing value cannot be a position)
Articles.keysetPage({ sort: [["rank", 1]], limit: 1 });
// @ts-expect-error an optional field cannot be a sort key
Articles.keysetPage({ sort: [["subtitle", 1]], limit: 1 });
// @ts-expect-error the sort is a non-empty list of pairs
Articles.keysetPage({ sort: [], limit: 1 });
// @ts-expect-error the filter is checked against the entity
Articles.keysetPage({ sort: [["score", 1]], limit: 1, filter: { scroe: 1 } });

// ---- views ------------------------------------------------------------------------------------------------
const view = TypedView.define(connection, TopArticle, {
  on: Article,
  pipeline: (p) => p.match({ score: { $gte: 5 } }).project({ title: 1, score: 1 }),
});
expectTypeOf(view).toEqualTypeOf<TypedView<TopArticle>>();
const rows = view.find({ score: { $gt: 1 } });
expectTypeOf<Awaited<typeof rows>>().toEqualTypeOf<
  ResultDoc<TopArticle, undefined, never, true, NoNarrowing, never>[]
>();
TypedView.define(connection, TopArticle, {
  on: Article,
  // @ts-expect-error the rows lack `score` of the view class (ViewRowCheck names the field)
  pipeline: (p) => p.project({ title: 1 }),
});
TypedView.define(connection, TopArticle, {
  on: Article,
  // @ts-expect-error `score` has another type in the rows
  pipeline: (p) => p.project({ title: 1, score: "$title" }),
});
// @ts-expect-error a view has no writes
view.updateOne(Filters.all(), { $set: { score: 1 } });
// @ts-expect-error the filter of a view read is checked against the view class
view.find({ views: 1 });

// ---- materialized -------------------------------------------------------------------------------------
Materialized.define(connection, StateTotal, {
  from: Article,
  pipeline: (p) => p.group((f) => ({ _id: f.state, total: fn.sum(f.score), count: fn.sum(1) })),
});
Materialized.define(connection, StateTotal, {
  from: Article,
  // @ts-expect-error `count` is missing from the rows
  pipeline: (p) => p.group((f) => ({ _id: f.state, total: fn.sum(f.score) })),
});
// A row may leave `_id` out: $merge/$out give an inserted row one.
Materialized.define(connection, TitleScore, {
  from: Article,
  on: "title",
  pipeline: (p) => p.project({ _id: 0, title: 1, score: 1 }),
});
// biome-ignore format: the @ts-expect-error must stay on the one line of the call
// @ts-expect-error `on` names a field of the target ("titel" is not one)
Materialized.define(connection, TitleScore, { from: Article, on: "titel", pipeline: (p) => p.project({ _id: 0, title: 1, score: 1 }) });

// ---- collections -----------------------------------------------------------------------------------------
expectTypeOf(Imageds.ensureCollection({ dryRun: true })).toEqualTypeOf<Promise<EnsureCollectionReport>>();
expectTypeOf(Imageds.createCollection()).toEqualTypeOf<Promise<boolean>>();
expectTypeOf(connection.syncAll({ dryRun: true })).toEqualTypeOf<Promise<SyncReport>>();
// @ts-expect-error createCollection takes no driver options: they come from the schema
Imageds.createCollection({ capped: true });

@Schema({ collection: "s9_types_clustered", clustered: { name: "c", expireAfterSeconds: 10 } })
export class ClusteredType {
  @Prop(() => Date, { required: true })
  _id!: Date;
}

// @ts-expect-error changeStreamPreAndPostImages is `true` or absent
@Schema({ collection: "s9_types_images", changeStreamPreAndPostImages: false })
export class ImagesOff extends Entity {}

// ---- @venloc/typemo/testing ------------------------------------------------------------------------------
const articles = defineFactory(Articles, (n) => ({
  title: `t${n}`,
  publishedAt: new Date(),
  score: n,
  views: 0n,
  rank: null,
}));
expectTypeOf(articles.create()).toEqualTypeOf<Promise<HydratedDoc<Article>>>();
// @ts-expect-error an override must be a field of the entity
articles.build({ titel: "x" });
// @ts-expect-error the defaults are a CreateInput: `score` must be a number
defineFactory(Articles, (n) => ({ title: `t${n}`, publishedAt: new Date(), score: "1", views: 0n, rank: null }));
expectTypeOf<IndexUsage["indexes"]>().toEqualTypeOf<readonly string[]>();
