/*
 * A base that lists its discriminators, on the real server: reads of the base model return every kind, each as
 * its class, and the typed union narrows by the key exactly as the rows are shaped; a base document has no key.
 * The default key and a custom `discriminatorKey` declared only in the type.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  Discriminator,
  type Discriminators,
  type DiscriminatorValue,
  Entity,
  type Model,
  Prop,
  Schema,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema({ collection: "d110_payments", discriminators: () => [Card, Transfer] })
class Payment extends Entity {
  declare readonly __t?: Discriminators<Card | Transfer>;
  @Prop(() => Number, { required: true }) amount!: number;
}
@Discriminator("card")
class Card extends Payment {
  declare readonly __t: DiscriminatorValue<"card">;
  @Prop(() => String, { required: true }) last4!: string;
}
@Discriminator("transfer")
class Transfer extends Payment {
  declare readonly __t: DiscriminatorValue<"transfer">;
  @Prop(() => String, { required: true }) iban!: string;
}

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

const t = ModelLifecycle.useTypemo("d110_list");
let Payments: Model<Payment>;
let Events: Model<Event>;

beforeEach(async () => {
  Payments = t.connection.model(Payment);
  Events = t.connection.model(Event);
  await t.mongo.db.collection("d110_payments").deleteMany({});
  await t.mongo.db.collection("d110_events").deleteMany({});
  await t.connection.model(Card).create({ amount: 30, last4: "4242" });
  await t.connection.model(Transfer).create({ amount: 500, iban: "PL61" });
  await Payments.create({ amount: 5 });
});

/**
 * Describes a row of the base model by its kind, through the narrowed union.
 * @param row A plain row of the base model.
 * @returns The description.
 */
const describeRow = (row: Awaited<ReturnType<typeof plainRows>>[number]): string => {
  if (row.__t === "card") return `card ${row.last4}`;
  if (row.__t === "transfer") return `transfer ${row.iban}`;
  return `payment ${row.amount}`;
};
/**
 * The plain rows of the base model, by amount.
 * @returns The rows.
 */
const plainRows = () => Payments.find().sort({ amount: 1 }).plain();

describe("reads of a base that lists its discriminators", () => {
  test("plain rows: the union narrows by the key; the base row has no key", async () => {
    const rows = await plainRows();
    expect(rows.map(describeRow)).toEqual(["payment 5", "card 4242", "transfer PL61"]);
    expect("__t" in (rows[0] as object)).toBe(false);
  });

  test("hydrated and lean reads: every document is its own class and form", async () => {
    const docs = await Payments.find().sort({ amount: 1 });
    expect(docs.map((doc) => doc.constructor.name)).toEqual(["Payment", "Card", "Transfer"]);
    const card = docs.find((doc) => doc instanceof Card);
    expect(card?.last4).toBe("4242");
    const lean = await Payments.findOne({ amount: 500 }).lean().orFail();
    expect(lean.__t === "transfer" ? lean.iban : null).toBe("PL61");
  });

  test("a custom key declared only in the type is written, read and narrows", async () => {
    await t.connection.model(Click).create({ element: "button" });
    await Events.create({ source: "api" });
    const stored = await t.mongo.db.collection("d110_events").find().sort({ _id: 1 }).toArray();
    expect(stored.map((row) => row.kind ?? null)).toEqual(["click", null]);
    const rows = await Events.find().sort({ _id: 1 }).lean();
    expect(rows.map((row) => (row.kind === "click" ? row.element : row.source))).toEqual(["button", "api"]);
  });
});
