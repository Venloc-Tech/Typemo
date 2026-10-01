import { describe, expect, test } from "bun:test";
import * as driver from "mongodb";
import { BsonGuards, ObjectIdCaster, Types } from "../../../src/internal.ts";

/* `Types` re-exports the driver's BSON classes (one source of classes, like `mongoose.Types`). */

describe("Types", () => {
  test("every class is the driver's own class (not bson's ESM copy)", () => {
    expect(Types.ObjectId).toBe(driver.ObjectId);
    expect(Types.UUID).toBe(driver.UUID);
    expect(Types.Decimal128).toBe(driver.Decimal128);
    expect(Types.Long).toBe(driver.Long);
    expect(Types.Double).toBe(driver.Double);
    expect(Types.Int32).toBe(driver.Int32);
    expect(Types.Binary).toBe(driver.Binary);
    expect(Types.Timestamp).toBe(driver.Timestamp);
    expect(Types.MinKey).toBe(driver.MinKey);
    expect(Types.MaxKey).toBe(driver.MaxKey);
  });

  test("exactly the classes of the value table: no legacy Code / BSONSymbol / DBRef / BSONRegExp", () => {
    expect(Object.keys(Types).sort()).toEqual(
      ["Binary", "Decimal128", "Double", "Int32", "Long", "MaxKey", "MinKey", "ObjectId", "Timestamp", "UUID"].sort(),
    );
  });

  test("a value built with Types is the class a cast returns (instanceof agrees)", () => {
    const id = new Types.ObjectId();
    expect(BsonGuards.isObjectId(id)).toBe(true);
    expect(ObjectIdCaster.cast(id.toHexString())).toBeInstanceOf(Types.ObjectId);
  });
});
