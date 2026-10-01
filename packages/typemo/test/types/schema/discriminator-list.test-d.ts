/*
 * A base that lists its discriminators — `@Schema({ discriminators: () => [...] })` with the key declared
 * `declare readonly __t?: Discriminators<A | B>` — reads as the union of the base without a key and every listed
 * class, narrowed by the key; with the default key and with a custom `discriminatorKey`. `@Schema` checks the
 * declaration against the option.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import {
  Discriminator,
  type Discriminators,
  type DiscriminatorValue,
  Entity,
  type Model,
  Prop,
  type ReadShape,
  Schema,
} from "../../../src/index.ts";

@Schema({ collection: "d110_payments", discriminators: () => [Card, Transfer, Instant] })
class Payment extends Entity {
  declare readonly __t?: Discriminators<Card | Transfer | Instant>;
  @Prop(() => Number, { required: true }) amount!: number;
}
@Discriminator("card")
class Card extends Payment {
  declare readonly __t: DiscriminatorValue<"card">;
  @Prop(() => String, { required: true }) last4!: string;
}
@Discriminator("transfer")
class Transfer extends Payment {
  declare readonly __t: DiscriminatorValue<"transfer" | "instant">;
  @Prop(() => String, { required: true }) iban!: string;
}
@Discriminator("instant")
class Instant extends Transfer {
  declare readonly __t: DiscriminatorValue<"instant">;
  @Prop(() => Number) seconds?: number;
}

declare const Payments: Model<Payment>;
declare const Cards: Model<Card>;

// Positive: plain rows narrow by the key; the base row has no key.
export const plainRows = async (): Promise<string[]> => {
  const rows = await Payments.find().plain();
  return rows.map((row) => {
    if (row.__t === "card") return `card ${row.last4}`;
    if (row.__t === "transfer" || row.__t === "instant") return `transfer ${row.iban}`;
    expectTypeOf(row.__t).toEqualTypeOf<undefined>();
    return `payment ${row.amount}`;
  });
};

// Positive: lean and hydrated reads, one document and lists.
export const leanRow = async (): Promise<void> => {
  const row = await Payments.findOne({ amount: 1 }).lean().orFail();
  if (row.__t === "card") expectTypeOf(row.last4).toEqualTypeOf<string>();
  const doc = await Payments.findById("0123456789abcdef01234567").orFail();
  /* "instant" is also a value of the intermediate Transfer (it declares "transfer" | "instant"): the class narrows. */
  if (doc instanceof Instant) expectTypeOf(doc.seconds).toEqualTypeOf<number | undefined>();
  if (doc.__t === "card") expectTypeOf(doc.last4).toEqualTypeOf<string>();
  if (doc instanceof Card) expectTypeOf(doc.last4).toEqualTypeOf<string>();
  const docs = await Payments.find();
  expectTypeOf(docs[0]?.amount).toEqualTypeOf<number | undefined>();
};

// Positive: a discriminator model and an unrelated model keep their own type.
export const childRows = async (): Promise<void> => {
  const card = await Cards.findOne().lean().orFail();
  expectTypeOf(card.__t).toEqualTypeOf<"card">();
};
expectTypeOf<ReadShape<Card>>().toEqualTypeOf<Card>();

// Positive: filters and updates of the base model stay on the base fields.
Payments.find({ amount: { $gt: 1 } });
// @ts-expect-error — `last4` is a field of Card, not of the base Payment
Payments.updateOne({ amount: 1 }, { $set: { last4: "1" } });

// Positive: a custom discriminatorKey, declared only in the type.
@Schema({ collection: "d110_events", discriminatorKey: "kind", discriminators: () => [Click] })
class Event extends Entity {
  declare readonly kind?: Discriminators<Click>;
  @Prop(() => String) source?: string;
}
@Discriminator("click")
class Click extends Event {
  declare readonly kind: DiscriminatorValue<"click">;
  @Prop(() => String, { required: true }) element!: string;
}
declare const Events: Model<Event>;
export const eventRows = async (): Promise<void> => {
  const rows = await Events.find().lean();
  for (const row of rows) if (row.kind === "click") expectTypeOf(row.element).toEqualTypeOf<string>();
};

// Negative: the option without the declaration.
// @ts-expect-error — declare readonly __t?: Discriminators<A | B>
@Schema({ collection: "d110_a", discriminators: () => [ChildA] })
class BaseA extends Entity {}
@Discriminator("a")
class ChildA extends BaseA {
  declare readonly __t: DiscriminatorValue<"a">;
}

// Negative: the declaration names other classes than the option.
// @ts-expect-error — the classes of __t: Discriminators<…> differ from the "discriminators" list
@Schema({ collection: "d110_b", discriminators: () => [ChildB] })
class BaseB extends Entity {
  declare readonly __t?: Discriminators<ChildB | OtherB>;
}
@Discriminator("b")
class ChildB extends BaseB {
  declare readonly __t: DiscriminatorValue<"b">;
  @Prop(() => String) b?: string;
}
@Discriminator("other")
class OtherB extends BaseB {
  declare readonly __t: DiscriminatorValue<"other">;
  @Prop(() => Number) other?: number;
}

// Negative: the declaration without the option.
// @ts-expect-error — "__t" is Discriminators<…>, but the schema has no "discriminators" option
@Schema({ collection: "d110_c" })
class BaseC extends Entity {
  declare readonly __t?: Discriminators<ChildC>;
}
@Discriminator("c")
class ChildC extends BaseC {
  declare readonly __t: DiscriminatorValue<"c">;
}

void [Payment, Card, Transfer, Instant, Event, Click, BaseA, ChildA, BaseB, ChildB, OtherB, BaseC, ChildC];
