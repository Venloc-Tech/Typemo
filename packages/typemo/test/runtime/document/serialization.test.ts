/*
 * `$toObject()` / `$toJSON()` / lean on the real server — plain data by the ONE conversion table,
 * the options (getters, virtuals, hidden, transform) at every depth, the JSON forms, and
 * Map → `Map` in `$toObject`, record in JSON. (`$toPlain()`: plain-form.test.ts.)
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Binary, Decimal128, ObjectId, Timestamp } from "mongodb";
import type { Model } from "../../../src/index.ts";
import { Line, Order } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("doc_serial");
let Orders: Model<Order>;

beforeEach(() => {
  Orders = t.connection.model(Order);
});

/**
 * Creates an order that has a value of every kind the conversions treat differently.
 * @returns The created order.
 */
const full = async () => {
  const created = await Orders.create({
    customer: "ann",
    tags: ["a"],
    lines: [{ sku: "x", qty: 1 }],
    address: { city: "Paris" },
    notes: { k: "v" },
    discount: 2.6,
    views: 42n,
    price: Decimal128.fromString("19.99"),
    seenAt: new Timestamp({ t: 7, i: 3 }),
    blob: new Binary(new Uint8Array([1, 2, 3])),
    pattern: /a.b/i,
    secret: "s3cret",
  });
  return Orders.findById(created._id).select({ "+secret": true }).orFail();
};

describe("$toObject", () => {
  test("plain data: arrays, Map kept, subdocuments plain objects, BSON values as they are (copied)", async () => {
    const order = await full();
    const plain = order.$toObject();
    expect(Array.isArray(plain.tags)).toBe(true);
    expect(plain.tags.constructor).toBe(Array);
    expect(plain.notes).toBeInstanceOf(Map);
    expect(plain.notes?.constructor).toBe(Map);
    expect(plain.notes?.get("k")).toBe("v");
    expect(plain.lines[0]).not.toBeInstanceOf(Line);
    expect(plain.lines[0]).toEqual({ _id: expect.any(ObjectId), sku: "x", qty: 1 });
    expect(plain.address).toEqual({ city: "Paris" });
    expect(plain.views).toBe(42n);
    expect(plain.price?.toString()).toBe("19.99");
    expect(plain.createdAt).toEqual(order.createdAt);
    expect(plain.createdAt).not.toBe(order.createdAt); /* a copy: never aliases the document */
    expect(plain.secret).toBe("s3cret"); /* loaded Hidden fields are in by default */
    expect("label" in plain).toBe(false); /* virtuals only with `virtuals: true` */
    expect(order.$toObject({ hidden: false })).not.toHaveProperty("secret");
  });

  test("getters, virtuals and a final transform", async () => {
    const order = await full();
    expect(order.$toObject().discount).toBe(2.6);
    expect(order.$toObject({ getters: true }).discount).toBe(3);
    expect(order.$get("discount")).toBe(3);
    /* the `get` option is for the API paths above: a plain property read and a lean row return the stored value */
    expect(order.discount).toBe(2.6);
    expect((await Orders.findById(order._id).lean().orFail()).discount).toBe(2.6);
    expect(order.$toObject({ virtuals: true }).label).toBe("ann#1");
    const summary = order.$toObject({ transform: (plain) => `${plain.customer}:${plain.tags.length}` });
    expect(summary).toBe("ann:1");
  });

  test("the document is not changed by serialization", async () => {
    const order = await full();
    order.$toObject({ getters: true, virtuals: true });
    order.$toJSON();
    expect(order.$isModified()).toBe(false);
  });
});

describe("$toJSON: the JSON forms", () => {
  test("every BSON value in its JSON form; Hidden out by default; Map → record", async () => {
    const order = await full();
    const json = order.$toJSON();
    expect(json._id).toBe(order._id.toHexString());
    expect(json.createdAt).toBe(order.createdAt.toISOString());
    expect(json.views).toBe("42"); /* int64 → a decimal string, not a JSON number */
    expect(json.price).toBe("19.99");
    expect(json.seenAt).toEqual({ t: 7, i: 3 }); /* Timestamp → { t, i } */
    expect(json.blob).toBe("AQID"); /* Binary → base64 */
    expect(json.pattern).toBe("/a.b/i"); /* RegExp → "/src/flags" */
    expect(json.notes).toEqual({ k: "v" });
    expect(json.lines[0]?._id).toBe(order.lines[0]?._id.toHexString());
    expect(json).not.toHaveProperty("secret");
    expect(order.$toJSON({ hidden: true }).secret).toBe("s3cret");
    expect(JSON.parse(JSON.stringify(order))).toEqual(json); /* JSON.stringify uses the same form */
  });

  test("an int64 beyond ±(2^53−1) is an exact decimal string (it was once a CastError)", async () => {
    const order = await Orders.create({ customer: "big", tags: [], lines: [], views: 9_007_199_254_740_993n });
    expect(order.$toJSON().views).toBe("9007199254740993");
    expect(JSON.parse(JSON.stringify(order)).views).toBe("9007199254740993");
    expect(order.$toObject().views).toBe(9_007_199_254_740_993n); /* toObject keeps the bigint */
  });
});

describe("lean", () => {
  test("lean() is plain data (Map as a record, the driver's values), never tracked", async () => {
    const order = await full();
    const lean = await Orders.findById(order._id).lean().orFail();
    expect(lean.notes).toEqual({ k: "v" });
    expect(lean.tags.constructor).toBe(Array);
    expect(lean).not.toBeInstanceOf(Order);
  });
});
