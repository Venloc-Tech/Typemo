/*
 * The types of the hook runtime (typed `this`, `skip(result)` by event, post arguments), of plugins (statics
 * through `model.statics(plugin)`, the LIMIT of plugin fields: invisible to the type), of the policy context and
 * of the document method `$updateOne`.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ClientSession, ObjectId } from "mongodb";
import {
  type BulkOperationResult,
  type ChangeKeys,
  type DeleteResult,
  Entity,
  type HydratedDoc,
  type Lean,
  type Model,
  type OperationHookContext,
  Plugin,
  type PolicyValues,
  Post,
  PostError,
  type PostResult,
  Pre,
  Prop,
  Schema,
  type SchemaPlugin,
  type SkipResult,
  type UpdateResult,
} from "../../../src/index.ts";

@Schema({ collection: "t9_items" })
class Item extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) n?: number;

  @Pre("query.find")
  cached(this: OperationHookContext<Item, "query.find">): void {
    expectTypeOf(this.event).toEqualTypeOf<"query.find">();
    expectTypeOf(this.filter).toEqualTypeOf<Readonly<Record<string, unknown>> | undefined>();
    expectTypeOf(this.session).toEqualTypeOf<ClientSession | undefined>();
    expectTypeOf(this.policy).toEqualTypeOf<Readonly<PolicyValues>>();
    expectTypeOf(this.locals).toEqualTypeOf<Map<string, unknown>>();
    // skip takes the lean documents of the entity for a find …
    this.skip([{ _id: {} as ObjectId, name: "x" }]);
    // @ts-expect-error — … not a number (that is a count's result)
    this.skip(3);
    // @ts-expect-error — a document must have the entity's required fields (name)
    this.skip([{ _id: {} as ObjectId }]);
    // A find can get a condition, a projection, a sort — typed by the entity
    this.modify({ where: { name: "x", n: { $gte: 1 } }, select: { name: 1 }, sort: { n: -1 } });
    // @ts-expect-error — a find has no update to change
    this.modify({ update: { $set: { n: 1 } } });
    // @ts-expect-error — stages are for an aggregation
    this.modify({ stages: [] });
    // @ts-expect-error — an unknown path in the condition
    this.modify({ where: { nope: 1 } });
    // @ts-expect-error — the value of a path is typed (n is a number)
    this.modify({ where: { n: "1" } });
  }

  @Pre("query.countDocuments")
  count(this: OperationHookContext<Item, "query.countDocuments">): void {
    this.modify({ where: { name: "x" } });
    // @ts-expect-error — a count has no sort
    this.modify({ sort: { n: 1 } });
    this.skip(0);
    // @ts-expect-error — a count skips with a number
    this.skip([]);
  }

  @Pre("query.updateMany")
  update(this: OperationHookContext<Item, "query.updateMany">): void {
    // An update gets a condition and operators merged into its update
    this.modify({ where: { name: "x" }, update: { $inc: { n: 1 } } });
    // @ts-expect-error — $inc takes a number for n
    this.modify({ update: { $inc: { n: "1" } } });
    // @ts-expect-error — an update has no projection
    this.modify({ select: { name: 1 } });
    this.skip({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null });
  }

  @Post("query.countDocuments")
  counted(this: OperationHookContext<Item>, result: number): void {
    void result;
  }

  @Post("document.save")
  saved(result: Item): void {
    void result;
  }

  @Post("document.deleteOne")
  deleted(result: DeleteResult): void {
    void result;
  }

  @PostError(["query.find", "query.findOne"])
  failed(this: OperationHookContext<Item>, error: unknown): void {
    void error;
  }
}

expectTypeOf<ChangeKeys<"aggregate">>().toEqualTypeOf<"stages">();
expectTypeOf<ChangeKeys<"model.insertMany">>().toEqualTypeOf<never>();
expectTypeOf<ChangeKeys<"query.findOneAndUpdate">>().toEqualTypeOf<"where" | "update" | "select" | "sort">();
expectTypeOf<SkipResult<"query.findOne", Item>>().toEqualTypeOf<Lean<Item> | null>();
expectTypeOf<SkipResult<"query.deleteMany", Item>>().toEqualTypeOf<DeleteResult>();
expectTypeOf<SkipResult<"query.updateOne", Item>>().toEqualTypeOf<UpdateResult<ObjectId>>();
/* A query post hook of one operation inside a bulkWrite gets that operation's result (only the upserted _id is known). */
expectTypeOf<PostResult<"query.updateOne", Item>>().toEqualTypeOf<
  UpdateResult<ObjectId> | Extract<BulkOperationResult<ObjectId>, { readonly matchedCount: null }>
>();
expectTypeOf<PostResult<"query.deleteOne", Item>>().toEqualTypeOf<
  DeleteResult | Extract<BulkOperationResult<ObjectId>, { readonly deletedCount: null }>
>();
expectTypeOf<OperationHookContext<Item, "query.updateOne">["bulkIndex"]>().toEqualTypeOf<number | undefined>();

@Schema()
class BulkPost extends Entity {
  @Post("query.updateOne") counted(
    this: OperationHookContext<BulkPost, "query.updateOne">,
    result: PostResult<"query.updateOne", BulkPost>,
  ): void {
    // @ts-expect-error — the matched count may be unknown (null) for one operation of a bulk
    const matched: number = result.matchedCount;
    void matched;
    if (this.bulkIndex === undefined && result.matchedCount !== null)
      expectTypeOf(result.matchedCount).toEqualTypeOf<number>();
  }
}
void BulkPost;

@Schema()
class BadPost extends Entity {
  // @ts-expect-error — a count's post hook receives a number, not a string
  @Post("query.countDocuments") wrong(this: OperationHookContext<BadPost>, result: string): void {
    void result;
  }
}
void BadPost;

// ---- plugins -------------------------------------------------------------------------------------------
interface Tools {
  byName(this: Model<Item>, name: string): Promise<number>;
}
const tools: SchemaPlugin<undefined, Tools> = {
  name: "tools",
  apply: (builder) => builder.addField("tag", () => String),
  statics: {
    byName(this: Model<Item>, name: string) {
      return this.countDocuments({ name }).exec();
    },
  },
};

@Plugin(tools)
@Schema({ collection: "t9_tooled" })
class Tooled extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

declare const Tooleds: Model<Tooled>;
expectTypeOf(Tooleds.statics(tools).byName).toEqualTypeOf<(name: string) => Promise<number>>();
// @ts-expect-error — without `statics(plugin)` the model has no plugin statics in its type
Tooleds.byName("x");
// The LIMIT of plugin fields: a field a plugin adds at compile time is not in the class type (a decorator
// or plugin cannot change a class type). Queries on it are type errors; a mixin base class is the typed way.
// @ts-expect-error — "tag" (added by the plugin) is unknown to the type
Tooleds.find({ tag: "x" });

// ---- policy context and $updateOne ----------------------------------------------------------------------
declare const Items: Model<Item>;
Items.find().policy({ tenant: "t", includeDeleted: true });
// @ts-expect-error — flags are `true` or absent
Items.find().policy({ includeDeleted: false });
// @ts-expect-error — unknown key
Items.find().policy({ tennant: "t" });
Items.insertMany([{ name: "a" }], { policy: { actor: "u1" } });

declare const item: HydratedDoc<Item>;
expectTypeOf(item.$updateOne({ $set: { n: 1 } })).toEqualTypeOf<Promise<UpdateResult<ObjectId>>>();
// @ts-expect-error — the update is checked like Model.updateOne's
item.$updateOne({ $set: { missing: 1 } });
