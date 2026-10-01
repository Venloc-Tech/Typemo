import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the ready-made masks — the value type of each mask, and a readable error when a mask
 * meets a field of another type.
 */

const IMPORTS = `
import { Entity, Mask, Prop, Schema } from "@venloc/typemo";
`;

describe("hover: Mask", () => {
  test("Mask.email() is a mask of strings", () => {
    expectHover(`${IMPORTS}
const email = Mask.email();
//    ^?
void email;`).toBe("const email: MaskOf<string>");
  });

  test("Mask.round accepts number, bigint and Decimal128", () => {
    expectHover(`${IMPORTS}
const rounded = Mask.round(10);
//    ^?
void rounded;`).toBe("const rounded: MaskOf<RoundableValue>");
  });

  test("the mask function shows its parameter (nullable included)", () => {
    expectHover(`${IMPORTS}
const fn = Mask.card().mask;
//    ^?
void fn;`).toBe("const fn: (value: string | null | undefined) => SensitiveJson");
  });

  test("Mask.when infers its type from the predicate", () => {
    expectHover(`${IMPORTS}
const chosen = Mask.when((value: number) => value > 0, "show", "mask");
//    ^?
void chosen;`).toBe("const chosen: MaskOf<number>");
  });

  test("a string mask on a number field is a readable error", () => {
    expectTypeError(`${IMPORTS}
@Schema() class User extends Entity {
  @Prop(() => Number, { sensitive: Mask.email() }) age?: number;
}`).toContain("MaskOf<string>");
  });
});
