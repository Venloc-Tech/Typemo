import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for masked results — `.mask()` of a lean query and of an aggregation, the `mask` option of
 * `$toPlain`, and a readable error for a path that is not in the row.
 */

const IMPORTS = `
import { Entity, Mask, type Model, Prop, Schema } from "@venloc/typemo";
@Schema() class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => Number, { required: true }) age!: number;
}
declare const Users: Model<User>;
`;

describe("hover: masked results", () => {
  test('lean().mask(): a masked field is "?", a function field its result', () => {
    expectHover(`${IMPORTS}
const run = async () => {
  const row = await Users.findOne({}).orFail().lean().mask({ email: "mask", age: (age: number) => age > 18 });
  //    ^?
  return row;
};`).toBe('const row: { name: string; email: "?"; age: boolean; _id: ObjectId; }');
  });

  test("aggregate().mask(): paths of the final row", () => {
    expectHover(`${IMPORTS}
const run = async () => {
  const rows = await Users.aggregate((p) => p.project({ email: 1 })).mask({ email: Mask.email() });
  //    ^?
  return rows;
};`).toBe("const rows: { email: SensitiveJson; _id: ObjectId; }[]");
  });

  test("$toPlain({ mask }): the masked copy", () => {
    expectHover(`${IMPORTS}
const run = async () => {
  const doc = await Users.findOne({}).orFail();
  const plain = doc.$toPlain({ mask: { email: "mask" } });
  //    ^?
  return plain;
};`).toBe('const plain: { name: string; email: "?"; age: number; _id: string; }');
  });

  test("a path that is not in the row is a readable error", () => {
    expectTypeError(`${IMPORTS}
void Users.find().lean().mask({ phone: "mask" });`).toContain("is not a path of the result row");
  });
});
