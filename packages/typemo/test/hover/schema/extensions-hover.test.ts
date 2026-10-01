import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for an extension option (typed by the field value) and the message of an unknown `ext` key.
 */

const IMPORTS = `
import { Entity, Prop, Schema, type PropExtensions } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> { hoverLabel?: { readonly label: string; readonly sample?: (value: V) => string } }
}
`;

describe("hover: schema extensions", () => {
  test("the extension option sees the field type", () => {
    expectHover(`${IMPORTS}
type DateExt = NonNullable<PropExtensions<Date>["hoverLabel"]>["sample"];
declare const sample: DateExt;
const s = sample;
//    ^?`).toBe("const s: ((value: Date) => string) | undefined");
  });

  test("an unknown ext key: the message names it", () => {
    expectTypeError(`${IMPORTS}
@Schema() class A extends Entity { @Prop(() => String, { ext: { nope: 1 } }) name?: string; }`).toContain(
      "'nope' does not exist in type 'PropExtensions<string>",
    );
  });
});
