/*
 * Regressions of Mongoose's middleware history (research/mongoose/M11-history/history.yaml,
 * `how_to_test`) against the hook runtime of Typemo.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Model,
  type OperationHookContext,
  Post,
  PostError,
  Pre,
  Prop,
  Schema,
  VersionError,
  Versioned,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("reg_hooks");

class Log {
  static lines: string[] = [];
}
beforeEach(() => {
  Log.lines = [];
});

@Schema({ collection: "reg_bulk_pre" })
class BulkPre extends Entity {
  @Prop(() => String) name?: string;
  @Pre("model.bulkWrite") fail(this: OperationHookContext<BulkPre>): void {
    throw new Error("pre bulkWrite");
  }
  @Post("model.bulkWrite") ok(this: OperationHookContext<BulkPre>): void {
    Log.lines.push("post");
  }
  @PostError("model.bulkWrite") error(this: OperationHookContext<BulkPre>, error: unknown): void {
    Log.lines.push(`postError ${(error as Error).message}`);
  }
}

@Schema({ collection: "reg_agg_pre" })
class AggPre extends Entity {
  @Prop(() => String) name?: string;
  @Pre("aggregate") fail(this: OperationHookContext<AggPre>): void {
    throw new Error("pre aggregate");
  }
}

@Schema({ collection: "reg_versioned" })
class Stale extends Versioned(Entity) {
  @Prop(() => [String]) arr?: string[];
  @PostError("document.save") error(this: Stale, error: unknown): void {
    Log.lines.push(`${(error as Error).name} ${this instanceof Stale}`);
  }
}

@Schema()
class Block {
  @Prop(() => String, { required: true }) kind!: string;
}

@Discriminator("text")
class TextBlock extends Block {
  declare readonly __t: DiscriminatorValue<"text">;
  @Prop(() => String) text?: string;
  @Pre("document.save") saved(this: TextBlock): void {
    Log.lines.push(`text pre save ${this.text}`);
  }
}

@Schema({ collection: "reg_pages" })
class Page extends Entity {
  @Prop(() => [Block]) blocks?: (Block | TextBlock)[];
}

@Schema({ collection: "reg_find_hooks" })
class Watched extends Entity {
  @Prop(() => String) name?: string;
  @Pre(["query.findOne", "query.find"]) any(this: OperationHookContext<Watched>): void {
    Log.lines.push(this.event);
  }
}

describe("history regressions (hooks)", () => {
  test("H077: pre('bulkWrite') throws → postError is called, post is not, nothing is written", async () => {
    const Model = t.connection.model(BulkPre);
    await expect(Model.bulkWrite([{ insertOne: { document: { name: "x" } } }])).rejects.toThrow("pre bulkWrite");
    expect(Log.lines).toEqual(["postError pre bulkWrite"]);
    expect(await t.mongo.db.collection("reg_bulk_pre").countDocuments()).toBe(0);
  });

  test("H131: pre('aggregate') throws → cursor.next() rejects", async () => {
    const cursor = t.connection
      .model(AggPre)
      .aggregate((p) => p.match({}))
      .cursor();
    await expect(cursor.next()).rejects.toThrow("pre aggregate");
  });

  test("H032: aggregate().cursor() before connect(): the pre hook runs once the connection is ready", async () => {
    const { TypemoClient } = await import("../../../src/index.ts");
    const { MongoHarness } = await import("@venloc/typemo-test-kit");
    const late = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName });
    const cursor = late.connection
      .model(AggPre)
      .aggregate((p) => p.match({}))
      .cursor();
    const next = cursor.next();
    await late.connect();
    await expect(next).rejects.toThrow("pre aggregate");
    await late.close();
  });

  test("H118: the postError(save) hook of a VersionError has the document (this)", async () => {
    const Model: Model<Stale> = t.connection.model(Stale);
    const created = await Model.create({ arr: ["a"] });
    const a = await Model.findById(created._id).orFail();
    const b = await Model.findById(created._id).orFail();
    a.arr?.push("b");
    await a.$save();
    b.arr?.set(0, "z");
    await expect(b.$save()).rejects.toBeInstanceOf(VersionError);
    expect(Log.lines).toEqual(["VersionError true"]);
  });

  test("H162 / H1455: pre('save') of an embedded discriminator runs", async () => {
    await t.connection.model(Page).create({ blocks: [{ __t: "text", kind: "t", text: "hello" } as never] });
    expect(Log.lines).toEqual(["text pre save hello"]);
  });

  test("H330: a save without changes sends nothing and runs no findOne hook", async () => {
    const Model = t.connection.model(Watched);
    const doc = await Model.create({ name: "x" });
    Log.lines = [];
    t.commands.clear();
    await doc.$save();
    expect(Log.lines).toEqual([]);
    expect(t.commands.all().filter((event) => event.commandName !== "endSessions").length).toBe(0);
  });

  test("H510: a synchronous throw in a pre hook rejects the operation", async () => {
    await expect(t.connection.model(BulkPre).bulkWrite([{ insertOne: { document: {} } }])).rejects.toThrow();
  });

  test("H174: a plugin static named like an operation cannot shadow it (no double hooks)", async () => {
    const { Plugin } = await import("../../../src/index.ts");
    @Plugin({ name: "shadow", apply: (builder) => builder.addStatic("aggregate", () => undefined) })
    @Schema({ collection: "reg_shadow" })
    class Shadow extends Entity {}
    expect(() => t.connection.model(Shadow)).toThrow(/would shadow a member of the model/);
  });
});
