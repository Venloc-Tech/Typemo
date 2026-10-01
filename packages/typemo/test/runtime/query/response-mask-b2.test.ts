/*
 * On the real server: `aggregate(...).mask(spec)` (paths of the final pipeline row, cursor too); the `mask`
 * option of `$toPlain` / `$toJSON` / `$toObject` (a masked COPY: the document and its next save are
 * untouched); populated paths; events and the audit trail see the real data.
 */

import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "bun:test";
import {
  Entity,
  type InstrumentationEvent,
  Mask,
  type Model,
  type OperationStartEvent,
  Prop,
  type Ref,
  Schema,
  type Subscription,
  Types,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A referenced entity with a plain title and a company number. */
@Schema({ collection: "s116b2_companies" })
class MaskCompany extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) inn!: string;
}

/** An audited entity with an email, an array and a reference to a company. */
@Schema({ collection: "s116b2_staff", audit: true })
class MaskStaff extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String) email?: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Types.ObjectId, { ref: () => MaskCompany }) company?: Ref<MaskCompany>;
}

const t = ModelLifecycle.useTypemo("mask116b2");
let Staff: Model<MaskStaff>;
let Companies: Model<MaskCompany>;
let subscription: Subscription | undefined;

beforeEach(async () => {
  Staff = t.connection.model(MaskStaff);
  Companies = t.connection.model(MaskCompany);
  const company = await Companies.create({ title: "Acme", inn: "7700000000" });
  await Staff.create({ name: "ann", email: "alice@gmail.com", tags: ["a", "b"], company: company._id });
});
afterEach(() => {
  subscription?.unsubscribe();
  subscription = undefined;
});

describe("aggregate(...).mask(spec)", () => {
  test("paths of the final row: masked; the type follows the spec", async () => {
    const rows = await Staff.aggregate((p) => p.project({ name: 1, email: 1 })).mask({
      email: Mask.email(),
      name: (name: string) => name.length,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe(Mask.email().mask("alice@gmail.com"));
    expect(rows[0]?.name).toBe(3);
    expectTypeOf<NonNullable<(typeof rows)[number]>["name"]>().toEqualTypeOf<number>();
  });

  test("plain aggregation and its cursor: every row masked as it is read", async () => {
    const seen: unknown[] = [];
    for await (const row of Staff.aggregate((p) => p.match({}))
      .plain()
      .mask({ email: "mask" })
      .cursor())
      seen.push(row.email);
    expect(seen).toEqual(["?"]);
  });

  test("a path that is not in the final row is a compile error; no preset", () => {
    const run = () =>
      Staff.aggregate((p) => p.project({ name: 1 }))
        // @ts-expect-error: `email` is not a path of the row after $project { name: 1 }.
        .mask({ email: "mask" });
    expect(typeof run).toBe("function");
    // @ts-expect-error: no "sensitive" preset (a pipeline row has no schema anyway).
    const preset = () => Staff.aggregate((p) => p.match({})).mask("sensitive");
    expect(typeof preset).toBe("function");
  });
});

describe("$toPlain / $toJSON / $toObject with { mask }", () => {
  test("a masked copy; the document and its next $save() are untouched", async () => {
    const doc = await Staff.findOne({ name: "ann" }).orFail();
    const plain = doc.$toPlain({ mask: { email: "mask", tags: (tags: readonly string[]) => tags.length } });
    expect(plain.email).toBe("?");
    expect(plain.tags).toBe(2); /* a leaf at an array path gets the whole array */
    /* optional stays optional: an absent field stays absent */
    expectTypeOf(plain.email).toEqualTypeOf<"?" | undefined>();
    expectTypeOf(plain.tags).toEqualTypeOf<number>();
    const json = doc.$toJSON({ mask: { email: Mask.email() } });
    expect(json.email).toBe(Mask.email().mask("alice@gmail.com"));
    const object = doc.$toObject({ mask: { name: "mask" }, transform: (value) => value.name });
    expect(object).toBe("?");
    expect(doc.email).toBe("alice@gmail.com");
    expect(doc.$isModified()).toBe(false);
    doc.name = "bob";
    await doc.$save();
    const stored = await t.mongo.db.collection("s116b2_staff").findOne({ _id: doc._id });
    expect(stored?.email).toBe("alice@gmail.com");
    expect(stored?.name).toBe("bob");
  });

  test("an unknown path of the serialized form is a compile error", async () => {
    const doc = await Staff.findOne({ name: "ann" }).orFail();
    // @ts-expect-error: `nope` is not a path of the plain form.
    const run = () => doc.$toPlain({ mask: { nope: "mask" } });
    expect(typeof run).toBe("function");
  });
});

describe("null/undefined at a mask path", () => {
  test("aggregate and $toPlain: null → '?', absent stays absent, the function is never called with them", async () => {
    /* A null written past the schema (raw driver): the guard still holds at run time. */
    await t.mongo.db.collection("s116b2_staff").insertOne({ name: "nil", email: null, tags: [] });
    await Staff.create({ name: "none", tags: [] });
    const seen: unknown[] = [];
    const spy = (value: string): number => {
      seen.push(value);
      return value.length;
    };
    const rows = await Staff.aggregate((p) => p.sort({ name: 1 }).project({ name: 1, email: 1 })).mask({ email: spy });
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("ann")?.email).toBe(15);
    expect(byName.get("nil")?.email).toBe("?");
    const none = byName.get("none");
    expect(none !== undefined && "email" in none).toBe(false);
    const doc = await Staff.findOne({ name: "none" }).orFail();
    const plain = doc.$toPlain({ mask: { email: spy } });
    expect("email" in plain).toBe(false);
    expectTypeOf(plain.email).toEqualTypeOf<number | "?" | undefined>();
    expect(seen).toEqual(["alice@gmail.com"]);
  });
});

describe("populated paths", () => {
  test("company.inn after populate is masked, the rest of the company kept", async () => {
    const row = await Staff.findOne({ name: "ann" }).populate("company").lean().mask({ "company.inn": "mask" });
    expect(row?.company?.inn).toBe("?");
    expect(row?.company?.title).toBe("Acme");
    expectTypeOf<NonNullable<NonNullable<typeof row>["company"]>["inn"]>().toEqualTypeOf<"?">();
  });
});

describe("telemetry sees the real data", () => {
  test("operation events: the real filter; operation.end counts the row; the caller gets the mask", async () => {
    const events: InstrumentationEvent[] = [];
    subscription = t.client.instrument({ handle: (event) => events.push(event), sensitive: "show" });
    const rows = await Staff.find({ email: "alice@gmail.com" }).lean().mask({ email: "mask" });
    expect(rows[0]?.email).toBe("?");
    const start = events.find(
      (event): event is OperationStartEvent => event.type === "operation.start" && event.operation === "find",
    );
    expect(start?.summary.filter).toMatchObject({ email: "alice@gmail.com" });
    const end = events.find((event) => event.type === "operation.end" && event.operation === "find");
    expect(end?.type === "operation.end" ? end.documentCount : undefined).toBe(1);
  });

  test("the audit trail holds the real update; the caller gets the masked row", async () => {
    const row = await Staff.findOneAndUpdate({ name: "ann" }, { $set: { email: "new@example.com" } })
      .lean()
      .mask({ email: "mask" });
    expect(row?.email).toBe("?");
    const entries = await t.mongo.db.collection("s116b2_staff_audit").find({}).toArray();
    expect(JSON.stringify(entries)).toContain("new@example.com");
    const stored = await t.mongo.db.collection("s116b2_staff").findOne({ name: "ann" });
    expect(stored?.email).toBe("new@example.com");
  });
});
