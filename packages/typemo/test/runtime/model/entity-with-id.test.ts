/*
 * Models whose `_id` is a string, a generated string, a UUID or a number, declared with `EntityWithId`: create (an
 * id required or generated), read by id, update, replace, references and populate, `$out` into a string-id target,
 * keyset paging and the errors of the `_id` rules. Real server.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { UUID } from "mongodb";
import {
  ConfigurationError,
  EntityWithId,
  fn,
  StrictModeError,
  Timestamped,
  ValidationError,
} from "../../../src/internal.ts";
import { City, Counter, Country, CountryTotal, Session, Tag } from "../../fixtures/model/id-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("w5_ids");

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("w5_")) await t.mongo.db.collection(name).deleteMany({});
  }
});

describe("a required string id", () => {
  test("create needs the id; it is stored as given and read back by findById", async () => {
    const Countries = t.connection.model(Country);
    const created = await Countries.create({ _id: "FR", name: "France" });
    expect(created._id).toBe("FR");
    expect((await t.mongo.db.collection("w5_countries").findOne({ _id: "FR" as never }))?.name).toBe("France");
    expect((await Countries.findById("FR").orFail().lean()).name).toBe("France");
    expect(await Countries.findById("DE")).toBeNull();
    /* The id is required: a document without one is refused before the server. */
    // @ts-expect-error `_id` is required for a base without a default
    await expect(Countries.create({ name: "Nowhere" })).rejects.toBeInstanceOf(ValidationError);
  });

  test("the id is immutable in an update and kept by a replacement without it", async () => {
    const Countries = t.connection.model(Country);
    await Countries.create({ _id: "FR", name: "France" });
    await expect(
      Promise.resolve(Countries.updateOne({ _id: "FR" }, { $set: { _id: "XX" } } as never)),
    ).rejects.toBeInstanceOf(StrictModeError);
    await Countries.replaceOne({ _id: "FR" }, { name: "La France" } as never);
    expect((await Countries.findById("FR").orFail().lean()).name).toBe("La France");
  });
});

describe("a generated id", () => {
  test("a UUID default fills the id; an explicit one is kept; timestamps and version compose", async () => {
    const Sessions = t.connection.model(Session);
    const created = await Sessions.create({ user: "ann" });
    expect(created._id).toBeInstanceOf(UUID);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.__v).toBe(0);
    const own = new UUID();
    expect((await Sessions.create({ _id: own, user: "bob" }))._id.equals(own)).toBe(true);
    const found = await Sessions.findById(created._id).orFail();
    expect(found.user).toBe("ann");
    expect((await Sessions.findById(created._id.toHexString()).orFail().lean()).user).toBe("ann");
  });

  test("a string default", async () => {
    const Tags = t.connection.model(Tag);
    const tag = await Tags.create({ label: "x" });
    expect(tag._id).toMatch(/^tag-/);
    expect((await Tags.findById(tag._id).orFail().lean()).label).toBe("x");
  });
});

describe("a number id", () => {
  test("create, find, update and the keyset page over it", async () => {
    const Counters = t.connection.model(Counter);
    await Counters.insertMany([1, 2, 3, 4, 5].map((_id) => ({ _id })));
    await Counters.updateOne({ _id: 3 }, { $inc: { hits: 5 } });
    expect((await Counters.findById(3).orFail().lean()).hits).toBe(5);
    const first = await Counters.keysetPage({ sort: [["hits", "desc"]], limit: 2 });
    expect(first.items.map((row) => row._id)).toEqual([3, 5]);
    const second = await Counters.keysetPage({ sort: [["hits", "desc"]], limit: 2, after: first.nextCursor });
    expect(second.items.map((row) => row._id)).toEqual([4, 2]);
  });
});

describe("references, populate and $out with other ids", () => {
  test("a reference by string id and an array of UUID references populate", async () => {
    const Countries = t.connection.model(Country);
    const Sessions = t.connection.model(Session);
    const Cities = t.connection.model(City);
    await Countries.create({ _id: "FR", name: "France" });
    const visitor = await Sessions.create({ user: "ann" });
    await Cities.create({ name: "Paris", country: "FR" as never, visitors: [visitor._id] as never });
    const city = await Cities.findOne({ name: "Paris" }).populate("country").populate("visitors").orFail();
    expect(city.country?.name).toBe("France");
    expect(city.visitors[0]?.user).toBe("ann");
  });

  test("$out into a model with a string id (the group key is the id)", async () => {
    const Cities = t.connection.model(City);
    const Totals = t.connection.model(CountryTotal);
    await Cities.insertMany([
      { name: "Paris", country: "FR" as never, visitors: [] },
      { name: "Lyon", country: "FR" as never, visitors: [] },
      { name: "Berlin", country: "DE" as never, visitors: [] },
    ]);
    await Cities.aggregate((p) => p.group((f) => ({ _id: f.name, cities: fn.sum(1) })).out(CountryTotal));
    const rows = await Totals.find().sort({ _id: 1 }).lean();
    expect(rows.map((row) => [row._id, row.cities])).toEqual([
      ["Berlin", 1],
      ["Lyon", 1],
      ["Paris", 1],
    ]);
  });
});

describe("the factory checks its arguments", () => {
  test("a spec that is not a function, or a default that is not a function", () => {
    expect(() => EntityWithId(String as never)).not.toThrow();
    expect(() => EntityWithId("x" as never)).toThrow(ConfigurationError);
    expect(() => EntityWithId(() => String, { default: "x" as never })).toThrow(ConfigurationError);
    expect(() => Timestamped(EntityWithId(() => String))).not.toThrow();
  });
});
