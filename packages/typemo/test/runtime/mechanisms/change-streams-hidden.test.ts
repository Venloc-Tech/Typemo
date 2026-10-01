/*
 * On the real replica set: `Hidden` values never reach a change stream event — positional paths
 * (`items.0.secret`), a replaced array or subdocument (the hidden field is taken out of the new value),
 * `removedFields`/`truncatedArrays`, and a stream with stages other than `$match` (refused while a hidden path
 * is not `include`d: its `updateDescription` could not be cleaned).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, type Hidden, type ModelChangeStream, Prop, QueryError, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s117_streams");

/** An array element with a hidden field. */
@Schema()
class HItem {
  @Prop(() => String) label?: string;
  @Prop(() => String, { hidden: true }) secret?: Hidden<string>;
}

/** A single subdocument with a hidden field. */
@Schema()
class HProfile {
  @Prop(() => String) city?: string;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}

/** The streamed root, with hidden fields at every depth. */
@Schema({ collection: "s117_streamed" })
class HStreamed extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) password?: Hidden<string>;
  @Prop(() => [HItem]) items?: HItem[];
  @Prop(() => HProfile) profile?: HProfile;
}

/**
 * Reads a number of events from a change stream.
 * @param stream The change stream.
 * @param count How many events to read.
 * @returns The events in order.
 */
const take = async <E>(stream: ModelChangeStream<E>, count: number): Promise<E[]> => {
  const out: E[] = [];
  while (out.length < count) out.push(await stream.next());
  return out;
};

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("s117_")) await t.mongo.db.dropCollection(name);
  }
  await t.connection.model(HStreamed).createCollection();
});

describe("Hidden values in updateDescription", () => {
  test("positional paths, a replaced array, a replaced subdocument, removed and truncated paths", async () => {
    const Model = t.connection.model(HStreamed);
    const stream = await Model.watch();
    const raw = t.mongo.db.collection("s117_streamed");
    const { insertedId } = await raw.insertOne({
      name: "a",
      password: "p0",
      items: [
        { label: "x", secret: "s0" },
        { label: "z", secret: "s1" },
      ],
      profile: { city: "Oslo", pin: "0000" },
    });
    await raw.updateOne({ _id: insertedId }, { $set: { password: "TOP-1", "items.0.secret": "TOP-2", name: "b" } });
    await raw.updateOne({ _id: insertedId }, { $set: { items: [{ label: "y", secret: "TOP-3" }] } });
    await raw.updateOne({ _id: insertedId }, { $set: { profile: { city: "Bergen", pin: "TOP-4" } } });
    await raw.updateOne({ _id: insertedId }, { $set: { "items.0": { label: "w", secret: "TOP-5" } } });
    await raw.updateOne({ _id: insertedId }, { $unset: { "items.0.secret": "", "profile.pin": "" } });
    const events = await take(stream, 6);
    await stream.close();
    const descriptions = events.slice(1).map((event) => {
      if (event.operationType !== "update") throw new Error("expected an update");
      return event.updateDescription;
    });
    expect(JSON.stringify(events)).not.toContain("TOP-");
    expect(descriptions[0]?.updatedFields).toEqual({ name: "b" });
    expect(descriptions[1]?.updatedFields).toEqual({ items: [{ label: "y" }] });
    expect(descriptions[2]?.updatedFields).toEqual({ profile: { city: "Bergen" } });
    expect(descriptions[3]?.updatedFields).toEqual({ "items.0": { label: "w" } });
    expect(descriptions[4]?.removedFields).toEqual([]);
  });

  test("include: the included hidden path is shown in positional form too", async () => {
    const Model = t.connection.model(HStreamed);
    const stream = await Model.watch({ include: ["items.secret"] });
    const raw = t.mongo.db.collection("s117_streamed");
    const { insertedId } = await raw.insertOne({ name: "a", items: [{ label: "x", secret: "s0" }] });
    await raw.updateOne({ _id: insertedId }, { $set: { "items.0.secret": "OPEN", password: "TOP" } });
    const [, update] = await take(stream, 2);
    await stream.close();
    if (update?.operationType !== "update") throw new Error("expected an update");
    expect(update.updateDescription.updatedFields).toEqual({ "items.0.secret": "OPEN" });
  });

  test("a stream with a stage other than $match on a model with Hidden fields is refused (unless all included)", async () => {
    const Model = t.connection.model(HStreamed);
    const error = await Model.watch((p) => p.project({ operationType: 1, updateDescription: 1 })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(QueryError);
    const open = await Model.watch((p) => p.project({ operationType: 1 }), {
      include: ["password", "items.secret", "profile.pin"],
    });
    await open.close();
  });
});
