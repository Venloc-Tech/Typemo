/*
 * Regressions of research/mongoose/M11-history/history.yaml (area `index`, and `connection`/`other` where
 * they concern collections and change streams): each test names its entry and follows its
 * `how_to_test`. H053 (watch before connect) is in test/regressions/connection.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Discriminator, type DiscriminatorValue, Entity, Index, Prop, Schema } from "../../../src/index.ts";
import { Reading } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("reg_s9");

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("r9_") || name.startsWith("s9_")) await t.mongo.db.dropCollection(name);
  }
});

@Schema({ collection: "r9_texts" })
@Index({ body: "text" })
@Index({ n: 1 })
class Texted extends Entity {
  @Prop(() => String)
  body?: string;

  @Prop(() => Number)
  n?: number;
}

describe("history: indexes and collections", () => {
  test("H103: a text index compares equal after syncIndexes (not a false difference)", async () => {
    const Texts = t.connection.model(Texted);
    await Texts.syncIndexes();
    expect(await Texts.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });

  test("H139: a repeated syncIndexes sends no createIndexes and no create", async () => {
    const Texts = t.connection.model(Texted);
    await Texts.syncIndexes();
    t.commands.clear();
    await Texts.syncIndexes();
    expect(t.commands.byName("createIndexes")).toEqual([]);
    expect(t.commands.byName("create")).toEqual([]);
    expect(t.commands.byName("dropIndexes")).toEqual([]);
  });

  test("H161: diffIndexes of a time series collection never drops the server's own index", async () => {
    const Readings = t.connection.model(Reading);
    await Readings.createCollection();
    const diff = await Readings.diffIndexes();
    expect(diff.toDrop).toEqual([]);
  });

  test("H217: diffIndexes before the collection exists: every index to create, no error", async () => {
    expect(await t.connection.model(Texted).diffIndexes()).toEqual({
      toCreate: ["body_text", "n_1"],
      toDrop: [],
      toModify: [],
    });
  });

  test("H464: syncing a connection with Base + discriminator keeps the base's indexes", async () => {
    @Schema({ collection: "r9_base" })
    @Index({ title: 1 })
    class Base extends Entity {
      @Prop(() => String)
      title?: string;
    }
    @Discriminator("special")
    class Special extends Base {
      declare readonly __t: DiscriminatorValue<"special">;
      @Prop(() => String, { index: true })
      extra?: string;
    }
    const connection = t.client.db(t.mongo.dbName);
    connection.model(Base);
    connection.model(Special);
    await connection.syncAll();
    // And the discriminator's own syncIndexes works on the collection's full set (root schema).
    await connection.model(Special).syncIndexes();
    const names = (await t.mongo.db.collection("r9_base").listIndexes().toArray()).map((index) => index.name).sort();
    expect(names).toEqual(["_id_", "extra_1", "title_1"]);
  });

  test("H480: text index + schema-level collation: declared simple, not dropped by syncIndexes", async () => {
    @Schema({ collection: "r9_text_collated", collation: { locale: "en", strength: 2 } })
    @Index({ body: "text" }, { collation: { locale: "simple" } })
    class TextCollated extends Entity {
      @Prop(() => String)
      body?: string;
    }
    const Model = t.connection.model(TextCollated);
    await Model.createCollection();
    await Model.syncIndexes();
    const second = await Model.syncIndexes();
    expect(second.toDrop).toEqual([]);
    expect(second.toCreate).toEqual([]);
  });
});
