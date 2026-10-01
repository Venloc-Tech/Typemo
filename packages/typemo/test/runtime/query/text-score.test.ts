/*
 * The text score field of `textScore(name)` on the server, through the full client (strict paths on): `{ sort: true }`
 * sorts by `{ $meta: "textScore" }`, the field is a known key of `sort()` (translated to the `$meta` sort) and of
 * `select()`, and `limit(1)` after a score sort returns the best match.
 */
import { beforeAll, beforeEach, describe, expect, expectTypeOf, test } from "bun:test";
import { Entity, Index, type Model, Prop, QueryError, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema({ collection: "ts_articles" })
@Index({ title: "text" })
class TsArticle extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  rank!: number;
}

const t = ModelLifecycle.useTypemo("query_text_score");
let Articles: Model<TsArticle>;

beforeAll(async () => {
  Articles = t.connection.model(TsArticle);
  await t.mongo.db.collection("ts_articles").createIndex({ title: "text" });
});

beforeEach(async () => {
  await Articles.insertMany([
    { title: "typed", rank: 1 },
    { title: "typed typed typed queries", rank: 2 },
    { title: "typed queries", rank: 3 },
    { title: "nothing", rank: 4 },
  ]);
});

const search = { $text: { $search: "typed" } } as const;

/**
 * The sort of the last `find` command, as [key, direction] pairs (the driver sends a Map).
 * @returns The pairs.
 */
const lastSort = (): unknown[] => [
  ...((t.commands.byName("find").at(-1)?.command.sort ?? new Map()) as Map<string, unknown>),
];
const META = { $meta: "textScore" };

describe("textScore on the server", () => {
  test("{ sort: true } sorts by the score: best match first, also with limit(1) and findOne", async () => {
    const rows = await Articles.find(search).textScore("score", { sort: true }).plain();
    expect(rows.map((row) => row.rank)).toEqual([2, 1, 3]);
    const scores = rows.map((row) => row.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const best = await Articles.find(search).textScore("score", { sort: true }).limit(1).lean();
    expect(best.map((row) => row.rank)).toEqual([2]);
    const one = await Articles.findOne(search).textScore("score", { sort: true });
    expect(one?.rank).toBe(2);
    expect(lastSort()).toEqual([["score", META]]);
  });

  test(".sort({ score: -1 }) is the $meta sort in its position; other keys keep theirs", async () => {
    t.commands.clear();
    const rows = await Articles.find(search).textScore().sort({ score: -1, rank: 1 }).lean();
    expect(rows.map((row) => row.rank)).toEqual([2, 1, 3]);
    expect(lastSort()).toEqual([
      ["score", META],
      ["rank", 1],
    ]);
    const after = await Articles.find(search).sort({ rank: -1 }).textScore("relevance", { sort: true }).lean();
    expect(after.map((row) => row.rank)).toEqual([3, 2, 1]);
    expect(lastSort()).toEqual([
      ["rank", -1],
      ["relevance", META],
    ]);
    /* Named by sort() and by { sort: true }: one key. */
    const both = await Articles.find(search)
      .textScore("score", { sort: true })
      .sort([["score", "desc"]])
      .lean();
    expect(both.map((row) => row.rank)).toEqual([2, 1, 3]);
  });

  test("an ascending score sort is a QueryError: the server orders a score from the best match only", () => {
    // @ts-expect-error the text score sorts descending only (-1)
    expect(() => Articles.find(search).textScore().sort({ score: 1 })).toThrow(QueryError);
    /* `as never`: before textScore() the type refuses the key; the run-time check is the subject here. */
    expect(() =>
      Articles.find(search)
        .sort({ score: 1 } as never)
        .textScore(),
    ).toThrow('sort: "score" is the text score, which sorts from the best match only');
  });

  test("select() names the score field: an inclusion keeps it", async () => {
    const rows = await Articles.find(search).textScore().select({ score: 1, rank: 1 }).sort({ score: -1 }).lean();
    expect(rows.map((row) => Object.keys(row).sort())).toEqual([
      ["_id", "rank", "score"],
      ["_id", "rank", "score"],
      ["_id", "rank", "score"],
    ]);
    type Row = (typeof rows)[number];
    expectTypeOf<keyof Row>().toEqualTypeOf<"_id" | "rank" | "score">();
    expectTypeOf<Row["score"]>().toEqualTypeOf<number>();
  });

  test("types: the score is a key of sort() and select() only after textScore()", () => {
    // @ts-expect-error "score" is not a field before textScore() names it
    void Articles.find(search).sort({ score: -1 });
    // @ts-expect-error "score" is not a field before textScore() names it
    void Articles.find(search).select({ score: 1 });
    void Articles.find(search)
      .textScore("relevance")
      .sort([["relevance", -1]]);
    // @ts-expect-error a sort is an object or a list of pairs, not a string, also with a text score
    expect(() => Articles.find(search).textScore().sort("-score")).toThrow(QueryError);
  });
});
