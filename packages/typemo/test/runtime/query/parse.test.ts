/*
 * `.parse(schema)` on the real server validates the rows of lean queries, aggregations and their
 * cursors by ANY Standard Schema v1 — here zod (a devDependency of the test kit only) and
 * the model's own `~standard`. The issues become ONE Typemo `ValidationError` (reason "schema", the row's index
 * first in the path); async schemas are awaited; "not found" stays `null`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { StandardSchemaKit, z } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import { DocumentNotFoundError, fn, QueryError, ValidationError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("parse");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
  t.commands.clear();
});

/** A zod schema that accepts only ObjectId instances. */
const objectId = z.custom<ObjectId>((value) => value instanceof ObjectId, "an ObjectId");
/** A zod schema of a person row. */
const PersonRow = z.object({ _id: objectId, name: z.string(), age: z.number().int().optional() });

/**
 * Runs an operation that must fail parse validation.
 * @param run The operation to run.
 * @returns The `ValidationError` it threw.
 */
const issuesOf = async (run: () => PromiseLike<unknown>): Promise<ValidationError> => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("expected a ValidationError");
};

describe("parse(zod) of lean queries", () => {
  test("find: every row validated, the schema's output returned (unknown keys stripped by zod, transforms applied)", async () => {
    const rows = await m.People.find()
      .sort({ name: 1 })
      .lean()
      .parse(z.object({ name: z.string().transform((name) => name.toUpperCase()), age: z.number().optional() }));
    expect(rows).toEqual([{ name: "ANN", age: 30 }, { name: "BOB", age: 40 }, { name: "CID" }, { name: "DAN" }]);
  });

  test("issues of every row in one ValidationError: the row's index first, reason 'schema', the zod issue as cause", async () => {
    const error = await issuesOf(() =>
      m.People.find()
        .sort({ name: 1 })
        .lean()
        .parse(z.object({ name: z.string(), age: z.number().min(35) })),
    );
    expect(error.issues.map((issue) => issue.path)).toEqual([
      [0, "age"],
      [2, "age"],
      [3, "age"],
    ]);
    expect(error.issues.every((issue) => issue.reason === "schema")).toBe(true);
    expect(error.issues[0]?.value).toBe(30);
    expect(error.issues[0]?.message).toMatch(/^row 0: /);
    expect((error.issues[0]?.cause as { code?: string } | undefined)?.code).toBe("too_small");
    expect(Object.keys(error.errors)).toEqual(["0.age", "2.age", "3.age"]);
  });

  test("nested paths map to segments (array indexes are numbers)", async () => {
    const error = await issuesOf(() =>
      m.People.findById(P.ann)
        .lean()
        .parse(z.object({ friends: z.array(z.string()) })),
    );
    expect(error.issues.map((issue) => issue.path)).toEqual([
      ["friends", 0],
      ["friends", 1],
      ["friends", 2],
    ]);
    expect(error.issues[0]?.value).toBeInstanceOf(ObjectId);
  });

  test("findOne / findById: one row, no index in the path; not found stays null (not validated)", async () => {
    const ann = await m.People.findById(P.ann).lean().parse(PersonRow);
    expect(ann?.name).toBe("ann");
    expect(await m.People.findOne({ name: "nobody" }).lean().parse(PersonRow)).toBeNull();
    const error = await issuesOf(() =>
      m.People.findOne({ name: "cid" })
        .lean()
        .parse(z.object({ age: z.number() })),
    );
    expect(error.issues[0]?.path).toEqual(["age"]);
    await expect(m.People.findOne({ name: "nobody" }).orFail().lean().parse(PersonRow).exec()).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
  });

  test("a populated lean row: the nested populated document is validated too", async () => {
    const post = await m.Posts.findById(P.p1)
      .populate({ path: "author", select: { name: 1 } })
      .orFail()
      .lean()
      .parse(z.object({ title: z.string(), author: z.object({ name: z.string() }) }));
    expect(post).toEqual({ title: "one", author: { name: "ann" } });
  });

  test("findOneAndUpdate (a write) parsed: runs once — a second await is refused", async () => {
    const query = m.People.findOneAndUpdate({ name: "cid" }, { $set: { age: 5 } })
      .lean()
      .parse(z.object({ name: z.string(), age: z.number() }));
    expect(await query).toEqual({ name: "cid", age: 5 });
    await expect(query.exec()).rejects.toThrow(QueryError);
    expect(t.commands.byName("findAndModify").length).toBe(1);
  });

  test("a read runs once per parsed query: later awaits share the result", async () => {
    const query = m.People.find().lean().parse(PersonRow);
    const first = await query;
    expect(await query).toBe(first);
    expect(t.commands.byName("find").length).toBe(1);
  });

  test("an async schema is awaited (zod async refinement)", async () => {
    const seen: string[] = [];
    const schema = z.object({
      name: z.string().refine(async (name) => {
        await Bun.sleep(1);
        seen.push(name);
        return name !== "bob";
      }, "not bob"),
    });
    const error = await issuesOf(() => m.People.find().sort({ name: 1 }).lean().parse(schema));
    expect(error.issues.map((issue) => [issue.path, issue.message])).toEqual([[[1, "name"], "row 1: not bob"]]);
    /*
     * every row went through the refinement (zod's `~standard.validate` tries a synchronous parse first and runs an
     * async schema again asynchronously, so a refinement may run twice per row: zod's behaviour, not Typemo's)
     */
    expect([...new Set(seen)].sort()).toEqual(["ann", "bob", "cid", "dan"]);
    expect(
      await m.People.find({ name: { $ne: "bob" } })
        .lean()
        .parse(schema),
    ).toHaveLength(3);
  });

  test("a schema that throws is a QueryError with the cause; a non-schema is refused at once", async () => {
    const broken = {
      "~standard": {
        version: 1 as const,
        vendor: "broken",
        validate: (): never => {
          throw new Error("boom");
        },
      },
    };
    const error = await m.People.find()
      .lean()
      .parse(broken)
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as Error).message).toMatch(/Standard Schema \(broken\) threw/);
    expect(((error as Error).cause as Error).message).toBe("boom");
    /* what a JS caller may pass (the type refuses it): not a schema */
    const notSchema = {} as typeof PersonRow;
    expect(() => m.People.find().lean().parse(notSchema)).toThrow(/a Standard Schema v1 validator/);
  });

  test("a hydrated query is refused at run time too (a JS caller)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: the type refuses parse() on a hydrated query; JS does not.
    const hydrated = m.People.find() as any;
    expect(() => hydrated.parse(PersonRow)).toThrow(/call \.lean\(\) or \.plain\(\) before \.parse\(schema\)/);
  });
});

describe("parse of cursors and aggregations", () => {
  test("cursor(): each row validated as it is read; an invalid row stops the stream with its position", async () => {
    const names: string[] = [];
    const cursor = m.People.find()
      .sort({ name: 1 })
      .batchSize(1)
      .lean()
      .parse(z.object({ name: z.string(), age: z.number() }))
      .cursor();
    const error = await (async () => {
      try {
        for await (const row of cursor) names.push(row.name);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(names).toEqual(["ann", "bob"]);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues[0]?.path).toEqual([2, "age"]);
    /* closed: reading it again is an error, not silently empty */
    await expect(cursor.next()).rejects.toThrow(/closed/);
  });

  test("cursor(): valid rows stream through (toArray)", async () => {
    const rows = await m.People.find()
      .sort({ name: 1 })
      .lean()
      .parse(z.object({ name: z.string() }))
      .cursor()
      .toArray();
    expect(rows.map((row) => row.name)).toEqual(["ann", "bob", "cid", "dan"]);
  });

  test("aggregate: the rows of the pipeline validated; its cursor too", async () => {
    const schema = z.object({ _id: z.string(), count: z.number().int() });
    const rows = await m.Posts.aggregate((p) =>
      p.group((f) => ({ _id: f.title, count: fn.sum(1) })).sort({ _id: 1 }),
    ).parse(schema);
    expect(rows.map((row) => row._id)).toEqual(["four", "one", "three", "two"]);
    const streamed = await m.Posts.aggregate((p) => p.group((f) => ({ _id: f.title, count: fn.sum(1) })))
      .parse(schema)
      .cursor()
      .toArray();
    expect(streamed).toHaveLength(4);
    const error = await issuesOf(() =>
      m.Posts.aggregate((p) => p.group((f) => ({ _id: f.title, count: fn.sum(1) })).sort({ _id: 1 })).parse(
        z.object({ _id: z.string().max(3) }),
      ),
    );
    expect(error.issues.map((issue) => issue.path)).toEqual([
      [0, "_id"],
      [2, "_id"],
    ]);
  });
});

describe("the model as a Standard Schema (~standard)", () => {
  test("a Standard-Schema-aware consumer validates with the model: defaults, casting, every issue", async () => {
    const ok = await StandardSchemaKit.validate(m.People, { name: "eve", friends: [] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.name).toBe("eve");
      expect(ok.value._id).toBeInstanceOf(ObjectId); /* the default of _id */
    }
    const bad = await StandardSchemaKit.validate(m.People, { name: 1, friends: ["x"], nope: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.map((issue) => issue.path).sort()).toEqual(["friends.0", "name", "nope"]);
    expect(m.People["~standard"].vendor).toBe("typemo");
    expect(m.People["~standard"].version).toBe(1);
  });

  test("~standard agrees with model.validate", async () => {
    const input = { name: "eve", age: 3, friends: [P.ann] };
    const { _id: _a, ...viaValidate } = await m.People.validate(input);
    const result = await m.People["~standard"].validate(input);
    if (result.issues !== undefined) throw new Error("expected a value");
    /* the same value, except the default _id (a new ObjectId per call) */
    const { _id: _b, ...viaStandard } = result.value;
    expect(viaStandard).toEqual(viaValidate);
    await expect(m.People.validate({ name: 1 })).rejects.toBeInstanceOf(ValidationError);
    expect((await m.People["~standard"].validate({ name: 1 })).issues?.map((issue) => issue.path)).toEqual([["name"]]);
  });

  test("a lean query parsed by a model: rows validated by the model's schema", async () => {
    const rows = await m.People.find().sort({ name: 1 }).lean().parse(m.People);
    expect(rows.map((row) => row.name)).toEqual(["ann", "bob", "cid", "dan"]);
    /* rows of People are not Companies: `age` is unknown to Company (strict), per row */
    const error = await issuesOf(() =>
      m.People.find().select({ name: 1, age: 1, _id: 0 }).sort({ name: 1 }).lean().parse(m.Companies),
    );
    expect(
      error.issues.map((issue) => [issue.path, (issue.cause as { message?: string }).message !== undefined]),
    ).toEqual([
      [[0, "age"], true],
      [[1, "age"], true],
    ]);
  });
});
