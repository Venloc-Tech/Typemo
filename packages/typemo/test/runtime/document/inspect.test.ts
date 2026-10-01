/*
 * `console.log` / `util.inspect` of a hydrated document and of its subdocuments: the class name and the plain data,
 * without the layer's internals (`$parent`, the tracking state) and without `Hidden` fields. The runtime classes of
 * the collections show the names of their public types.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import type { Model } from "../../../src/index.ts";
import { Order } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("doc_inspect");
let Orders: Model<Order>;

beforeEach(() => {
  Orders = t.connection.model(Order);
});

/**
 * Creates and reloads an order with a nested subdocument, a subdocument array, an array and a Hidden field.
 * @returns The loaded order (its Hidden `secret` is not selected).
 */
const load = async () => {
  const created = await Orders.create({
    customer: "ann",
    tags: ["a", "b"],
    lines: [{ sku: "x", qty: 1 }],
    address: { city: "Paris" },
    secret: "s3cret",
  });
  return Orders.findById(created._id).orFail();
};

describe("inspect of a hydrated document", () => {
  test("the class name and the data: no $parent, no internals", async () => {
    const order = await load();
    const text = inspect(order, { depth: 4 });
    expect(text).toStartWith("Order {");
    expect(text).toContain("customer: 'ann'");
    expect(text).toContain("city: 'Paris'");
    expect(text).not.toContain("$parent");
    expect(text).not.toContain("Layer");
    expect(text).not.toContain("[Function");
  });

  test("a Hidden field does not appear, even when it is loaded", async () => {
    const created = await Orders.create({ customer: "bob", tags: [], lines: [], secret: "s3cret" });
    const loaded = await Orders.findById(created._id).select({ "+secret": true }).orFail();
    expect(loaded.secret).toBe("s3cret");
    expect(inspect(loaded, { depth: 4 })).not.toContain("s3cret");
    expect(inspect(created, { depth: 4 })).not.toContain("s3cret");
  });

  test("a subdocument prints as its class and its data", async () => {
    const order = await load();
    const line = inspect(order.lines[0], { depth: 4 });
    expect(line).toStartWith("Line {");
    expect(line).toContain("sku: 'x'");
    expect(line).not.toContain("$parent");
    const address = inspect(order.address, { depth: 4 });
    expect(address).toStartWith("Address {");
    expect(address).toContain("city: 'Paris'");
  });

  test("the depth of the caller is kept: past it the document is [Name]", async () => {
    const order = await load();
    expect(inspect({ order }, { depth: 0 })).toContain("[Order]");
  });

  test("a document that was deleted still prints", async () => {
    const order = await load();
    await order.$deleteOne();
    expect(inspect(order)).toStartWith("Order {");
  });
});

describe("constructor.name of the strict collections is the public type", () => {
  test("arrays: StrictArray and SubdocumentArray", async () => {
    const order = await load();
    expect(order.tags.constructor.name).toBe("StrictArray");
    expect(order.lines.constructor.name).toBe("SubdocumentArray");
  });
});
