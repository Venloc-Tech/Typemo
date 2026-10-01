/*
 * `select` with a projection of unknown shape — a declared `Projection<T>` value, a dynamic `Record<string, 0 | 1>`,
 * `untrusted(fields, "projection")` — on the real server: accepted by the types with every field optional in the
 * result, run as given, and checked at run time (an unknown path is a `StrictModeError`, inclusion mixed with
 * exclusion a `QueryError`).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { expectTypeOf } from "@venloc/typemo-test-kit";
import {
  Entity,
  type Hidden,
  type Projection,
  Prop,
  QueryError,
  Schema,
  StrictModeError,
  untrusted,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("w5_wide_projection");

@Schema({ collection: "w5_wide_projection_cards" })
class Card extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) rank!: number;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}

beforeEach(async () => {
  const Cards = t.connection.model(Card);
  await Cards.deleteMany({ rank: { $gte: 0 } });
  await Cards.create({ title: "a", rank: 1, pin: "1234" });
});

describe("select with a projection of unknown shape", () => {
  test("a declared Projection<T> value: run as given, the result has every field optional", async () => {
    const Cards = t.connection.model(Card);
    const projection: Projection<Card> = { title: 1, _id: 0 };
    const row = await Cards.findOne().select(projection).orFail().lean();
    expect(row).toEqual({ title: "a" });
    expectTypeOf(row.title).toEqualTypeOf<string | undefined>();
    const withPin: Projection<Card> = { "+pin": true };
    const pinned = await Cards.findOne().select(withPin).orFail().lean();
    expect(pinned.pin).toBe("1234");
    expectTypeOf(pinned.pin).toEqualTypeOf<string | undefined>();
  });

  test("a dynamic Record and untrusted(fields): run as given", async () => {
    const Cards = t.connection.model(Card);
    const fields: Record<string, 1> = { rank: 1 };
    const rows = await Cards.find().select(untrusted(fields, "projection")).lean();
    expect(rows.map((row) => Object.keys(row).sort())).toEqual([["_id", "rank"]]);
    expectTypeOf(rows[0]?.rank).toEqualTypeOf<number | undefined>();
    const plain = await Cards.findOne().select(fields).orFail().lean();
    expect(plain.rank).toBe(1);
  });

  test("an unknown path and mixed modes are refused at run time", async () => {
    const Cards = t.connection.model(Card);
    const unknownPath: Record<string, 1> = { nope: 1 };
    expect(
      await Cards.find()
        .select(unknownPath)
        .catch((error: unknown) => error),
    ).toBeInstanceOf(StrictModeError);
    const mixed: Record<string, 0 | 1> = { title: 1, rank: 0 };
    expect(() => Cards.find().select(mixed)).toThrow(QueryError);
  });
});
