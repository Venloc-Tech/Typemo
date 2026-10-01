import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the reads of a base that lists its discriminators (the key of the union, narrowed), and
 * the readable errors of a declaration that does not match the `discriminators` option.
 */

const IMPORTS = `
import { Entity, Prop, Schema, Discriminator, type Discriminators, type DiscriminatorValue, type Model } from "@venloc/typemo";
@Schema({ collection: "d110h_payments", discriminators: () => [Card, Transfer] })
class Payment extends Entity {
  declare readonly __t?: Discriminators<Card | Transfer>;
  @Prop(() => Number, { required: true }) amount!: number;
}
@Discriminator("card") class Card extends Payment {
  declare readonly __t: DiscriminatorValue<"card">;
  @Prop(() => String, { required: true }) last4!: string;
}
@Discriminator("transfer") class Transfer extends Payment {
  declare readonly __t: DiscriminatorValue<"transfer">;
  @Prop(() => String, { required: true }) iban!: string;
}
declare const Payments: Model<Payment>;
`;

describe("hover: a base that lists its discriminators", () => {
  test("the key of a read row: the literals of the classes, or absent", () => {
    expectHover(`${IMPORTS}
const row = await Payments.findOne().plain().orFail();
const key = row.__t;
//    ^?`).toBe('const key: "card" | "transfer" | undefined');
  });

  test("the key narrows the row", () => {
    expectHover(`${IMPORTS}
const row = await Payments.findOne().lean().orFail();
if (row.__t === "card") {
  const last4 = row.last4;
  //    ^?
}`).toBe("const last4: string");
  });

  test("the option without the declaration names what to declare", () => {
    expectTypeError(`${IMPORTS}
@Schema({ collection: "d110h_a", discriminators: () => [A] }) class Base extends Entity {}
@Discriminator("a") class A extends Base { declare readonly __t: DiscriminatorValue<"a">; }`).toContain(
      "@Schema: declare the discriminator key with the listed classes — declare readonly __t?: Discriminators<A | B>",
    );
  });

  test("the declaration without the option", () => {
    expectTypeError(`${IMPORTS}
@Schema({ collection: "d110h_b" }) class Base extends Entity { declare readonly __t?: Discriminators<B>; }
@Discriminator("b") class B extends Base { declare readonly __t: DiscriminatorValue<"b">; }`).toContain(
      '@Schema: \\"__t\\" is Discriminators<…>, but the schema has no \\"discriminators\\" option',
    );
  });
});
