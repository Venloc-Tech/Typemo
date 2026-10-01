import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the option `sensitive` — the field's mask function typed by the field, the subscriber's
 * function with its `{ path }`, and readable errors for wrong values.
 */

const IMPORTS = `
import { Entity, Prop, Schema, type InstrumentationSubscriber, type SubscriberSensitive } from "@venloc/typemo";
@Schema() class Card { @Prop(() => String) holder?: string; }
`;

describe("hover: sensitive", () => {
  test("the value of a field mask function is the field's type", () => {
    expectHover(`${IMPORTS}
@Schema() class User extends Entity {
  @Prop(() => String, { sensitive: { mask: (value) => value.length } }) email?: string;
//                                          ^?
}`).toBe("(parameter) value: string");
  });

  test("a number field: the mask gets a number", () => {
    expectHover(`${IMPORTS}
@Schema() class User extends Entity {
  @Prop(() => Number, { sensitive: { mask: (value) => value > 0 } }) age?: number;
//                                          ^?
}`).toBe("(parameter) value: number");
  });

  test("the subscriber function gets (value: unknown, { path })", () => {
    expectHover(`${IMPORTS}
const subscriber: InstrumentationSubscriber = {
  handle: () => undefined,
  sensitive: { mask: (value, context) => String(context.path) + String(value) },
//                           ^?
};
void subscriber;`).toBe("(parameter) context: {\n    readonly path: string;\n}");
  });

  test("SubscriberSensitive shows the four modes", () => {
    expectHover(`${IMPORTS}
declare const mode: SubscriberSensitive;
const shown = mode;
//    ^?
void shown;`).toBe("const shown: SubscriberSensitive");
  });

  test('"omit" (the old audit option) is a readable error on a field', () => {
    expectTypeError(`${IMPORTS}
@Schema() class User extends Entity {
  @Prop(() => String, { sensitive: "omit" }) x?: string;
}`).toContain('"omit"');
  });

  test("a subscriber mode outside the four is an error", () => {
    expectTypeError(`${IMPORTS}
const subscriber: InstrumentationSubscriber = { handle: () => undefined, sensitive: "none" };
void subscriber;`).toContain('"none"');
  });

  test("a field mask returning a non-JSON value is an error", () => {
    expectTypeError(`${IMPORTS}
@Schema() class User extends Entity {
  @Prop(() => String, { sensitive: { mask: (value) => new Date(value) } }) x?: string;
}`).toContain("Date");
  });
});
