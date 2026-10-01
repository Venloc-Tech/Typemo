/*
 * The read operations of a model through the operation pipeline, on the real server —
 * hydration (entity instances, Maps, subdocuments, discriminators), lean, Hidden fields, orFail,
 * count/estimated/distinct (`null` as the server returns it), exists, explain, memoization.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Decimal128, ObjectId } from "mongodb";
import { DocumentNotFoundError, type Model, StrictModeError } from "../../../src/index.ts";
import { Circle, Person, Pet, Shape, Square } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("reads");
const ids = { ann: new ObjectId(), bob: new ObjectId(), eve: new ObjectId() };
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await t.mongo.db.collection("m_people").insertMany([
    {
      _id: ids.ann,
      name: "Ann",
      email: "ann@x.test",
      age: 34,
      role: "admin",
      secret: "s-ann",
      tags: ["vip", "early"],
      pets: [{ name: "Rex", age: 3 }],
      scores: { math: 5, art: 3 },
      visits: 10n,
      balance: Decimal128.fromString("1.50"),
      lastSeen: new Date("2026-01-02T00:00:00Z"),
    },
    { _id: ids.bob, name: "Bob", email: "bob@x.test", age: 17, role: "user", tags: ["new"], pets: [], lastSeen: null },
    { _id: ids.eve, name: "Eve", email: "eve@x.test", role: "user", tags: [], pets: [], lastSeen: null },
  ]);
  t.commands.clear();
});

describe("find / findOne / findById: hydrated documents", () => {
  test("instances of the entity class; subdocuments of their class; Map fields are Maps; int64 is bigint", async () => {
    const ann = await People.findById(ids.ann).orFail();
    expect(ann).toBeInstanceOf(Person);
    expect(ann.pets[0]).toBeInstanceOf(Pet);
    expect(ann.scores).toBeInstanceOf(Map);
    expect(ann.scores?.get("math")).toBe(5);
    expect(ann.visits).toBe(10n);
    expect(ann.balance?.toString()).toBe("1.50");
    expect(ann.lastSeen).toBeInstanceOf(Date);
  });

  test("Hidden fields are not read unless asked (`+field`)", async () => {
    const ann = await People.findById(ids.ann).orFail();
    expect("secret" in ann).toBe(false);
    const withSecret = await People.findById(ids.ann).select({ "+secret": true }).orFail();
    expect(withSecret.secret).toBe("s-ann");
    const [command] = t.commands.byName("find");
    expect(command?.command.projection).toEqual({ secret: 0 });
  });

  test("`+field` of an unknown path is a StrictModeError unknown-path, like `{ nope: 1 }`; nothing is sent", async () => {
    t.commands.clear();
    /* cast: unknown paths passed on purpose, the types refuse them */
    for (const projection of [{ "+nope": true }, { name: 1, "+nope": true }, { name: 0, "+nope": true }] as never[]) {
      const error = await People.find()
        .select(projection)
        .lean()
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StrictModeError);
      expect((error as StrictModeError).reason).toBe("unknown-path");
      expect((error as StrictModeError).path).toBe("projection.+nope");
      expect((error as Error).message).toBe('projection: "nope" is not a field of Person [unknown-path]');
    }
    expect(t.commands.byName("find")).toEqual([]);
  });

  test("`+field` of a field that is not Hidden is a StrictModeError; nothing is sent", async () => {
    t.commands.clear();
    /* cast: the types accept "+path" only for Hidden paths; this is the untyped call (or a wide Record projection) */
    for (const projection of [{ "+name": true }, { name: 1, "+name": true }, { age: 0, "+name": true }] as never[]) {
      const error = await People.find()
        .select(projection)
        .lean()
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StrictModeError);
      expect((error as StrictModeError).reason).toBe("not-hidden");
      expect((error as StrictModeError).path).toBe("projection.+name");
      expect((error as Error).message).toBe(
        'projection: "+name" adds a Hidden field back, and "name" is not Hidden; select it without the "+" [not-hidden]',
      );
    }
    expect(t.commands.byName("find")).toEqual([]);
  });

  test("a dynamic filter typed Record<string, unknown> compiles; its paths are checked when the query runs", async () => {
    const fromRequest: Record<string, unknown> = JSON.parse('{ "name": "Ann", "tags.0": "vip" }');
    expect((await People.find(fromRequest).lean()).map((person) => person.name)).toEqual(["Ann"]);
    expect(await People.countDocuments(fromRequest)).toBe(1);
    expect((await People.findOne(fromRequest).lean())?.name).toBe("Ann");
    const unknownPath: { [key: string]: unknown } = { nope: 1 };
    const error = await People.find(unknownPath)
      .lean()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("unknown-path");
    const written = await People.updateOne(fromRequest, { $set: { age: 35 } });
    expect(written.modifiedCount).toBe(1);
  });

  test("lean: plain objects, Map fields stay records", async () => {
    const ann = await People.findOne({ name: "Ann" }).lean().orFail();
    expect(Object.getPrototypeOf(ann)).toBe(Object.prototype);
    expect(ann.scores).toEqual({ math: 5, art: 3 });
  });

  test("filters, sort (with words), skip, limit, projection", async () => {
    const names = (
      await People.find({ age: { $exists: true } })
        .sort({ age: "desc" })
        .lean()
    ).map((p) => p.name);
    expect(names).toEqual(["Ann", "Bob"]);
    const page = await People.find()
      .sort([["name", "ascending"]])
      .skip(1)
      .limit(1)
      .select({ name: 1 })
      .lean();
    expect(page).toEqual([{ _id: ids.bob, name: "Bob" }]);
    /* The driver sends an ordered sort as a Map; the word "ascending" became 1 before it. */
    expect(t.commands.byName("find").at(-1)?.command.sort).toEqual(new Map([["name", 1]]));
  });

  test("findOne without a match: null; orFail: DocumentNotFoundError", async () => {
    expect(await People.findOne({ name: "Nobody" })).toBeNull();
    const error = await People.findOne({ name: "Nobody" })
      .orFail()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentNotFoundError);
    expect((error as DocumentNotFoundError).operation).toBe("findOne");
    expect((error as DocumentNotFoundError).model).toBe("Person");
  });

  test("find().orFail(): an empty list is an error; a non-empty list is returned; a cursor does not fail", async () => {
    const error = await People.find({ name: "Nobody" })
      .orFail()
      .plain()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentNotFoundError);
    expect((error as DocumentNotFoundError).operation).toBe("find");
    expect((await People.find({ name: "Ann" }).orFail().lean()).map((p) => p.name)).toEqual(["Ann"]);
    expect(await People.find({ name: "Nobody" }).orFail().lean().cursor().toArray()).toEqual([]);
  });

  test("where() chains and narrow run on the server", async () => {
    const admins = await People.find().where("role").in(["admin"]).where("age").gte(18).lean();
    expect(admins.map((p) => p.name)).toEqual(["Ann"]);
  });
});

describe("counts, distinct, exists", () => {
  test("countDocuments (skip/limit), estimatedDocumentCount", async () => {
    expect(await People.countDocuments()).toBe(3);
    expect(await People.countDocuments({ role: "user" })).toBe(2);
    expect(await People.countDocuments().skip(1).limit(1)).toBe(1);
    expect(await People.estimatedDocumentCount()).toBe(3);
  });

  test("distinct unwinds arrays; a nullable path includes null as the server does", async () => {
    expect((await People.distinct("tags")).sort()).toEqual(["early", "new", "vip"]);
    const seen = await People.distinct("lastSeen");
    expect(seen.some((value) => value === null)).toBe(true);
    expect(seen.length).toBe(2);
  });

  test("exists: { _id } or null", async () => {
    expect(await People.exists({ name: "Bob" })).toEqual({ _id: ids.bob });
    expect(await People.exists({ name: "Nobody" })).toBeNull();
  });
});

describe("explain and memoization", () => {
  test("explain runs the same plan with explain (find and findOne)", async () => {
    const plan = await People.find({ name: "Ann" }).explain("executionStats");
    expect(plan).toHaveProperty("queryPlanner");
    expect(plan).toHaveProperty("executionStats");
    expect(await People.findOne({ name: "Ann" }).explain()).toHaveProperty("queryPlanner");
  });

  test("awaiting the same read twice returns the same result with ONE round trip", async () => {
    const query = People.find({ role: "user" }).lean();
    const first = await query;
    await t.mongo.db.collection("m_people").deleteMany({});
    expect(await query).toBe(first);
    expect(t.commands.byName("find").length).toBe(1);
    expect(await query.sort({ name: 1 })).toEqual([]);
  });
});

describe("discriminators", () => {
  test("a query of the root hydrates each document as its own class", async () => {
    const Shapes = t.connection.model(Shape);
    await t.mongo.db.collection("m_shapes").insertMany([
      { label: "c", __t: "circle", radius: 2 },
      { label: "s", __t: "square", side: 3 },
    ]);
    const shapes = await Shapes.find().sort({ label: 1 });
    expect(shapes[0]).toBeInstanceOf(Circle);
    expect(shapes[1]).toBeInstanceOf(Square);
    /* The root model does not know its discriminators in the type: narrow by the class. */
    const [first] = shapes;
    expect(first instanceof Circle && first.radius).toBe(2);
  });
});
