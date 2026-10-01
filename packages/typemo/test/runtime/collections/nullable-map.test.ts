/*
 * `Spec.map(X, { nullable: true })` — `null` is a value of the map (`Map<string, X | null>`),
 * in the types and at run time: create, read, `set(k, null)`, lean, `$toObject`, `$toJSON`, the cast of a
 * map without the option (null refused), and the JSON schema. Mongoose gh-9628 is the ported side.
 */
import { beforeEach, describe, expect, expectTypeOf, test } from "bun:test";
import {
  CastError,
  Entity,
  JsonSchemaGenerator,
  type Model,
  Prop,
  Schema,
  SchemaCompiler,
  Spec,
  type TypedMap,
} from "../../../src/internal.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A nested value stored in the nullable map. */
@Schema({ nested: true })
class Message {
  @Prop(() => String) text?: string;
}

/** A root with nullable and strict (non-nullable) maps. */
@Schema({ collection: "k10_inbox" })
class Inbox extends Entity {
  @Prop(() => Spec.map(Message, { nullable: true })) messages!: Map<string, Message | null>;
  @Prop(() => Spec.map(Number, { nullable: true })) scores?: Map<string, number | null>;
  @Prop(() => Spec.map(Number)) strict?: Map<string, number>;
}

const t = ModelLifecycle.useTypemo("k10_nullable_map");
let Inboxes: Model<Inbox>;

beforeEach(() => {
  Inboxes = t.connection.model(Inbox);
  t.commands.clear();
});

describe("Spec.map(X, { nullable: true })", () => {
  test("null values are stored, read back as null, and typed X | null", async () => {
    const created = await Inboxes.create({ messages: { a: { text: "hi" }, b: null }, scores: { x: 1, y: null } });
    const raw = await t.mongo.db.collection("k10_inbox").findOne({ _id: created._id });
    expect(raw?.messages).toEqual({ a: { text: "hi" }, b: null });
    const doc = await Inboxes.findById(created._id).orFail();
    expectTypeOf(doc.messages).toEqualTypeOf<TypedMap<import("../../../src/index.ts").Subdocument<Message> | null>>();
    expect(doc.messages.get("b")).toBeNull();
    expect(doc.messages.get("a")?.text).toBe("hi");
    expect(doc.scores?.get("y")).toBeNull();
    const lean = await Inboxes.findById(created._id).lean().orFail();
    expectTypeOf(lean.scores).toEqualTypeOf<{ [key: string]: number | null } | undefined>();
    expect(lean.messages).toEqual({ a: { text: "hi" }, b: null });
    expect(doc.$toObject().messages).toEqual(
      new Map([
        ["a", { text: "hi" }],
        ["b", null],
      ]),
    );
    expect(doc.$toJSON().scores).toEqual({ x: 1, y: null });
  });

  test("set(k, null) sends $set of the key to null; a later value replaces it", async () => {
    const created = await Inboxes.create({ messages: {}, scores: { x: 1 } });
    const doc = await Inboxes.findById(created._id).orFail();
    doc.scores?.set("x", null);
    doc.messages.set("m", null);
    t.commands.clear();
    await doc.$save();
    const update = t.commands.byName("update")[0]?.updates[0]?.update as Record<string, unknown>;
    expect(update.$set).toMatchObject({ "scores.x": null, "messages.m": null });
    doc.messages.set("m", { text: "later" });
    await doc.$save();
    const again = await Inboxes.findById(created._id).lean().orFail();
    expect(again).toMatchObject({ scores: { x: null }, messages: { m: { text: "later" } } });
  });

  test("without the option null is refused at once, in the map methods and on create", async () => {
    const doc = Inboxes.new({ messages: {}, strict: { a: 1 } });
    // @ts-expect-error — `strict` values are `number`: null is not a value of this map
    expect(() => doc.strict?.set("a", null)).toThrow(CastError);
    // @ts-expect-error — the same on create
    expect(() => Inboxes.new({ messages: {}, strict: { a: null } })).toThrow(CastError);
  });

  test("the option must agree with the field type (both ways)", () => {
    @Schema({ collection: "k10_bad" })
    class Bad extends Entity {
      // @ts-expect-error — the field has `| null` values, the spec has no `nullable: true`
      @Prop(() => Spec.map(Number)) a?: Map<string, number | null>;
      // @ts-expect-error — `nullable: true` on the spec, the field values have no `| null`
      @Prop(() => Spec.map(Number, { nullable: true })) b?: Map<string, number>;
    }
    expect(Bad.name).toBe("Bad");
  });

  test("the JSON schema allows null values", () => {
    const schema = JsonSchemaGenerator.generate(SchemaCompiler.compile(Inbox)) as {
      readonly properties: Readonly<
        Record<string, { readonly additionalProperties?: { readonly bsonType?: unknown } }>
      >;
    };
    expect(schema.properties.scores?.additionalProperties?.bsonType).toContain("null");
    expect(schema.properties.strict?.additionalProperties?.bsonType).not.toContain("null");
  });
});
