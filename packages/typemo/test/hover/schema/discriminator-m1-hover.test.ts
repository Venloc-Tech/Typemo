import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * The errors of a missing or wrong `DiscriminatorValue` declaration are readable (the message names the fix),
 * and what the IDE shows for the declared key.
 */

const IMPORTS = `
import { Entity, Prop, Schema, Discriminator, type DiscriminatorValue, type HydratedDoc, type Lean } from "@venloc/typemo";
@Schema({ collection: "m1h_shapes" }) class Shape extends Entity { @Prop(() => String) label?: string; }
`;

describe("hover: discriminator declarations", () => {
  test("no declaration: the message says what to declare", () => {
    expectTypeError(`${IMPORTS}
@Discriminator("circle") class Circle extends Shape { @Prop(() => Number) radius?: number; }`).toContain(
      '@Discriminator(\\"circle\\"): declare the discriminator key with its value in the class — declare readonly __t: DiscriminatorValue<\\"circle\\">',
    );
  });

  test("another literal: the message names both", () => {
    expectTypeError(`${IMPORTS}
@Discriminator("circle") class Circle extends Shape { declare readonly __t: DiscriminatorValue<"square">; }`).toContain(
      '@Discriminator: the class declares __t as \\"square\\", but the value is \\"circle\\"',
    );
  });

  test("no value: the message asks for a literal", () => {
    expectTypeError(`${IMPORTS}
@Discriminator() class Circle extends Shape { declare readonly __t: DiscriminatorValue<"Circle">; }`).toContain(
      "@Discriminator(): pass the value as a literal",
    );
  });

  test("the declared key is the literal in the lean form", () => {
    expectHover(`${IMPORTS}
@Discriminator("circle") class Circle extends Shape { declare readonly __t: DiscriminatorValue<"circle">; }
declare const c: Lean<Circle>;
const key = c.__t;
//    ^?`).toBe('const key: "circle"');
  });

  test("the hydrated form shows the plain literal (a branded literal does not narrow a union)", () => {
    expectHover(`${IMPORTS}
@Discriminator("circle") class Circle extends Shape { declare readonly __t: DiscriminatorValue<"circle">; }
declare const c: HydratedDoc<Circle>;
const key = c.__t;
//    ^?`).toBe('const key: "circle"');
  });
});
