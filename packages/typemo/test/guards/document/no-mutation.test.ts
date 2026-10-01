/*
 * The input of `new`/`create`/`$set`/`bulkSave` and the options objects are never changed — frozen inputs work (a
 * mutation would throw) and stay equal.
 */
import { describe, expect, test } from "bun:test";
import { Order } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("doc_nomut");

/** Freezes `value` and everything reachable from it. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

describe("documents do not mutate their input", () => {
  test("new / create / $set / $save options / $toObject options with frozen input", async () => {
    const Orders = t.connection.model(Order);
    const input = deepFreeze({
      customer: "a",
      tags: ["x"],
      lines: [{ sku: "s", qty: 1 }],
      address: { city: "Paris" },
      notes: { k: "v" },
    });
    const before = JSON.stringify(input);
    const order = await Orders.create(input);
    const other = Orders.new(input);
    expect(other.tags).not.toBe(input.tags);
    order.$set("lines", deepFreeze([{ sku: "t", qty: 2 }]));
    order.$set("address", deepFreeze({ city: "Rome" }));
    const saveOptions = deepFreeze({ timeoutMS: 5_000 });
    await order.$save(saveOptions);
    order.$toObject(deepFreeze({ virtuals: true }));
    await Orders.bulkSave(Object.freeze([other])); /* the list is frozen (not the documents: they change on save) */
    expect(JSON.stringify(input)).toBe(before);
    expect(saveOptions).toEqual({ timeoutMS: 5_000 });
  });
});
