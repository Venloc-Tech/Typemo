/*
 * On the real server: `.mask(spec)` masks the result of lean and plain queries and their cursors — nested
 * paths, array elements, Map values; a throwing mask is a QueryError; a hydrated query is refused. There is
 * no "sensitive" preset; a null/undefined value is "?" and the mask function is not called.
 */

import { beforeEach, describe, expect, expectTypeOf, test } from "bun:test";
import {
  Entity,
  Mask,
  type Model,
  type OperationHookContext,
  Post,
  Prop,
  QueryError,
  Schema,
  Spec,
  StrictModeError,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** An array element with plain fields. */
@Schema()
class Address {
  @Prop(() => String, { required: true }) street!: string;
  @Prop(() => String, { required: true }) city!: string;
}

/** A Map value holding a token. */
@Schema()
class Secret {
  @Prop(() => String, { required: true }) token!: string;
}

/** A person with marked fields, an array, a Map and a nullable field. */
@Schema({ collection: "s116b_people" })
class MaskedPerson extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { sensitive: Mask.email() }) email?: string;
  @Prop(() => String, { sensitive: "hide" }) pin?: string;
  @Prop(() => String, { sensitive: "mask" }) phone?: string;
  @Prop(() => [Address]) addresses!: Address[];
  @Prop(() => Spec.map(Secret)) settings!: Map<string, Secret>;
  @Prop(() => Date) birthday?: Date;
  @Prop(() => String, { nullable: true }) nick?: string | null;
}

const t = ModelLifecycle.useTypemo("mask116b");
let People: Model<MaskedPerson>;

beforeEach(async () => {
  People = t.connection.model(MaskedPerson);
  await People.create({
    name: "ann",
    email: "alice@gmail.com",
    pin: "1234",
    phone: "+79990001122",
    addresses: [
      { street: "Main 1", city: "Oslo" },
      { street: "Side 2", city: "Rome" },
    ],
    settings: new Map([["api", { token: "tok-secret" }]]),
  });
});

describe(".mask(spec)", () => {
  test("lean: top-level, array elements and Map values masked; other fields as they are", async () => {
    const rows = await People.find()
      .lean()
      .mask({ email: Mask.email(), "addresses.street": "mask", "settings.$*.token": "mask" });
    expect(rows).toHaveLength(1);
    const [first] = rows;
    expect(first?.email).toBe(Mask.email().mask("alice@gmail.com"));
    expect(first?.addresses.map((one) => one.street)).toEqual(["?", "?"]);
    expect(first?.addresses.map((one) => one.city)).toEqual(["Oslo", "Rome"]);
    expect(first?.settings.api?.token).toBe("?");
    expect(first?.name).toBe("ann");
    expectTypeOf<NonNullable<typeof first>["addresses"][number]["street"]>().toEqualTypeOf<"?">();
    expectTypeOf<NonNullable<typeof first>["name"]>().toEqualTypeOf<string>();
  });

  test("plain: Maps are Maps, masked per value; a function gets the value", async () => {
    const row = await People.findOne({ name: "ann" })
      .plain()
      .mask({ name: (name: string) => name.length, "settings.$*.token": Mask.keep({ end: 3 }) });
    expect(row?.name).toBe(3);
    expect(row?.settings.get("api")?.token).toBe(Mask.keep({ end: 3 }).mask("tok-secret"));
    expectTypeOf<NonNullable<typeof row>["name"]>().toEqualTypeOf<number>();
  });

  test("cursor: every row masked as it is read", async () => {
    const seen: unknown[] = [];
    for await (const row of People.find().lean().mask({ email: "mask" }).cursor()) seen.push(row.email);
    expect(seen).toEqual(["?"]);
  });

  test("the result of an unmasked query is untouched (the same query without .mask())", async () => {
    const row = await People.findOne({ name: "ann" }).lean();
    expect(row?.email).toBe("alice@gmail.com");
  });

  test("a throwing mask is a QueryError naming the path and the model, the error as cause", async () => {
    const boom = new Error("boom");
    const run = People.find()
      .lean()
      .mask({
        email: () => {
          throw boom;
        },
      });
    const error = await run.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).message).toContain('"email"');
    expect((error as QueryError).message).toContain("MaskedPerson");
    expect((error as QueryError).cause).toBe(boom);
  });

  test("a hydrated query: compile error, and a QueryError for JS", () => {
    // @ts-expect-error: mask() needs .lean() or .plain() — a hydrated document with masked values could be saved
    expect(() => People.find().mask({ email: "mask" })).toThrow(QueryError);
  });

  test("an unknown path is a compile error (and a StrictModeError at run time)", () => {
    // @ts-expect-error: "emial" is not a path of the result row
    expect(() => People.find().lean().mask({ emial: "mask" })).toThrow(StrictModeError);
    const lean = People.find().lean();
    // @ts-expect-error: a mask function of a string cannot take a number
    void lean.mask({ email: (value: number) => value });
  });
});

describe('no preset; null/undefined is "?" without calling the mask', () => {
  test('the "sensitive" preset no longer exists', () => {
    const lean = People.find().lean();
    // @ts-expect-error: the "sensitive" preset overload of mask() was removed
    const preset = () => lean.mask("sensitive");
    expect(typeof preset).toBe("function");
    /* A JS caller passing a string gets a QueryError (the spec is an object of paths). */
    /* cast: calling the removed overload at run time on purpose */
    expect(() => (lean.mask as (spec: unknown) => unknown)("sensitive")).toThrow(QueryError);
  });

  test("only the listed paths are masked; schema marks are not applied, nothing is excluded", async () => {
    t.commands.clear();
    const row = await People.findOne({ name: "ann" }).lean().mask({ name: "mask" });
    expect(row?.name).toBe("?");
    expect(row?.email).toBe("alice@gmail.com");
    expect(row?.pin).toBe("1234");
    const find = t.commands.byName("find")[0];
    expect((find?.command as { projection?: unknown } | undefined)?.projection).toBeUndefined();
  });

  test("null → '?', a missing key stays missing, a function never sees null/undefined", async () => {
    await People.create({ name: "bob", nick: null, addresses: [], settings: new Map() });
    await People.updateOne({ name: "ann" }, { $set: { birthday: new Date("1990-05-06T00:00:00Z"), nick: "annie" } });
    const seen: unknown[] = [];
    const year = (d: Date): number => {
      seen.push(d);
      return d.getUTCFullYear();
    };
    const nick = (value: string): number => {
      seen.push(value);
      return value.length;
    };
    const rows = await People.find().sort({ name: 1 }).lean().mask({ birthday: year, nick });
    expectTypeOf<(typeof rows)[number]["birthday"]>().toEqualTypeOf<number | "?" | undefined>();
    expectTypeOf<(typeof rows)[number]["nick"]>().toEqualTypeOf<number | "?" | undefined>();
    const [ann, bob] = rows;
    expect(ann?.birthday).toBe(1990);
    expect(ann?.nick).toBe(5);
    expect(bob?.nick).toBe("?");
    expect(bob !== undefined && "birthday" in bob).toBe(false);
    expect(seen.some((value) => value === null || value === undefined)).toBe(false);
    expect(seen).toHaveLength(2);
  });

  test("a mask function takes the value without null/undefined (compiles on an optional Date)", () => {
    const lean = People.find().lean();
    const typed = () => lean.mask({ birthday: (d) => d.getFullYear() });
    expect(typeof typed).toBe("function");
    // @ts-expect-error: the parameter is `Date`, not a string
    void (() => lean.mask({ birthday: (d: string) => d }));
  });
});

const seenByHook: unknown[] = [];

@Schema({ collection: "s116b_hooked" })
class Hooked extends Entity {
  @Prop(() => String, { required: true }) email!: string;

  @Post("query.findOne")
  after(this: OperationHookContext<Hooked, "query.findOne">, row: unknown): void {
    seenByHook.push((row as { email?: unknown } | null)?.email);
  }
}

describe("hooks see the real data", () => {
  test("a post hook gets the real row; only the caller's result is masked", async () => {
    const Hooks = t.connection.model(Hooked);
    await Hooks.create({ email: "real@example.com" });
    seenByHook.length = 0;
    const row = await Hooks.findOne({}).lean().mask({ email: "mask" });
    expect(row?.email).toBe("?");
    expect(seenByHook).toEqual(["real@example.com"]);
  });
});

describe("a mask path must name a path of the rows (checked like select)", () => {
  test("find and findOne: an unknown path is StrictModeError unknown-path, before anything is sent", async () => {
    t.commands.clear();
    const find = (() =>
      People.find()
        .lean()
        .mask({ nope: "mask" } as never)) as () => unknown;
    expect(find).toThrow(StrictModeError);
    let caught: unknown;
    try {
      People.findOne()
        .lean()
        .mask({ "addresses.zip": "mask" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StrictModeError);
    expect((caught as StrictModeError).reason).toBe("unknown-path");
    expect((caught as Error).message).toContain('"addresses.zip"');
    /* Below a scalar there is nothing either. */
    expect(() =>
      People.find()
        .lean()
        .mask({ "email.x": "mask" } as never),
    ).toThrow(StrictModeError);
    expect(t.commands.byName("find").length).toBe(0);
  });

  test("known paths pass: nested, array elements, Map values by $* and by key, a text score", async () => {
    const rows = await People.find()
      .lean()
      /* cast: a concrete Map key is not a typed mask path (only `$*` is); the run-time check accepts it */
      .mask({ "settings.api.token": "mask", "addresses.city": "mask", birthday: "mask" } as never);
    /* cast: the mask was passed through `never`, so the row type no longer names the Map values */
    expect((rows as unknown as { settings: Record<string, { token: string }> }[])[0]?.settings.api?.token).toBe("?");
  });

  test("$toPlain / $toJSON with mask: an unknown path is refused", async () => {
    const person = await People.findOne().orFail();
    expect(() => person.$toPlain({ mask: { nope: "mask" } as never })).toThrow(StrictModeError);
    expect(() => person.$toJSON({ mask: { "addresses.nope": "mask" } as never })).toThrow(StrictModeError);
    expect((person.$toPlain({ mask: { email: "mask" } }) as { email?: unknown }).email).toBe("?");
  });

  test("aggregate: a path that matches nothing in the rows is refused; one that matches passes", async () => {
    const error = await People.aggregate((p) => p.project({ name: 1 }))
      .mask({ email: "mask" } as never)
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("unknown-path");
    const rows = await People.aggregate((p) => p.project({ name: 1 })).mask({ name: "mask" });
    expect(rows[0]?.name).toBe("?");
    /* No rows: nothing to tell by. */
    expect(
      await People.aggregate((p) => p.match({ name: "nobody" }).project({ name: 1 })).mask({ name: "mask" }),
    ).toEqual([]);
  });

  test("aggregate cursor: the unmatched path is reported when the stream ends", async () => {
    const cursor = People.aggregate((p) => p.project({ name: 1 }))
      .mask({ email: "mask" } as never)
      .cursor();
    const error = await cursor.toArray().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StrictModeError);
  });
});
