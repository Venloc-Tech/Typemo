import { Discriminator, type DiscriminatorValue, Entity, Prop, Schema } from "@venloc/typemo";
import type { Document } from "mongodb";
import type { Rng } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/** The discriminator values, in the order documents cycle through them. */
export const EVENT_KINDS = ["click", "view", "purchase", "signup", "failure"] as const;

/** The base event: the common fields of every discriminator. */
@Schema({ collection: "bench_events", discriminatorKey: "kind" })
export class EventDoc extends Entity {
  @Prop(() => String) kind!: string;
  @Prop(() => Date, { required: true }) at!: Date;
  @Prop(() => String, { required: true, index: true }) actor!: string;
  @Prop(() => Number, { required: true, min: 0 }) seq!: number;
}

/** A click at screen coordinates. */
@Discriminator("click")
export class ClickEvent extends EventDoc {
  declare readonly kind: DiscriminatorValue<"click">;
  @Prop(() => Number, { required: true, min: 0 }) x!: number;
  @Prop(() => Number, { required: true, min: 0 }) y!: number;
}

/** A page view. */
@Discriminator("view")
export class ViewEvent extends EventDoc {
  declare readonly kind: DiscriminatorValue<"view">;
  @Prop(() => String, { required: true }) url!: string;
  @Prop(() => Number, { min: 0 }) durationMs?: number;
}

/** A purchase. */
@Discriminator("purchase")
export class PurchaseEvent extends EventDoc {
  declare readonly kind: DiscriminatorValue<"purchase">;
  @Prop(() => Number, { required: true, min: 0 }) amount!: number;
  @Prop(() => String, { required: true, enum: ["USD", "EUR", "JPY"] }) currency!: "USD" | "EUR" | "JPY";
}

/** A sign-up. */
@Discriminator("signup")
export class SignupEvent extends EventDoc {
  declare readonly kind: DiscriminatorValue<"signup">;
  @Prop(() => String, { required: true }) email!: string;
}

/** A failure with an error code. */
@Discriminator("failure")
export class FailureEvent extends EventDoc {
  declare readonly kind: DiscriminatorValue<"failure">;
  @Prop(() => Number, { required: true }) code!: number;
  @Prop(() => String) message?: string;
}

/**
 * Generates the input of one event; the kind cycles with the index.
 *
 * @param i - The document index.
 * @param rng - The random source seeded for this document.
 * @returns The input document.
 */
const generate = (i: number, rng: Rng): Document => {
  const kind = EVENT_KINDS[i % EVENT_KINDS.length] ?? "click";
  const base = { kind, at: rng.date(), actor: `actor-${rng.int(0, 999)}`, seq: i };
  switch (kind) {
    case "click":
      return { ...base, x: rng.int(0, 1920), y: rng.int(0, 1080) };
    case "view":
      return { ...base, url: `/page/${rng.word()}`, durationMs: rng.int(0, 60_000) };
    case "purchase":
      return { ...base, amount: rng.money(1, 999), currency: rng.pick(["USD", "EUR", "JPY"] as const) };
    case "signup":
      return { ...base, email: `s${i}@bench.test` };
    case "failure":
      return { ...base, code: rng.int(400, 599), message: rng.words(4) };
  }
};

/** Shape 10: 5 discriminators in one collection (`kind`). */
export const EVENTS = new ShapeDef<EventDoc>({
  name: "events",
  namespace: 0x0e7e000a,
  collection: "bench_events",
  entity: EventDoc,
  mongooseName: "BenchEvent",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        at: { type: Date, required: true },
        actor: { type: String, required: true, index: true },
        seq: { type: Number, required: true, min: 0 },
      },
      { versionKey: false, discriminatorKey: "kind" },
    ),
  mongooseDiscriminators: [
    {
      name: "BenchClick",
      value: "click",
      schema: (m) =>
        new m.Schema(
          { x: { type: Number, required: true, min: 0 }, y: { type: Number, required: true, min: 0 } },
          { versionKey: false },
        ),
    },
    {
      name: "BenchView",
      value: "view",
      schema: (m) =>
        new m.Schema(
          { url: { type: String, required: true }, durationMs: { type: Number, min: 0 } },
          { versionKey: false },
        ),
    },
    {
      name: "BenchPurchase",
      value: "purchase",
      schema: (m) =>
        new m.Schema(
          {
            amount: { type: Number, required: true, min: 0 },
            currency: { type: String, required: true, enum: ["USD", "EUR", "JPY"] },
          },
          { versionKey: false },
        ),
    },
    {
      name: "BenchSignup",
      value: "signup",
      schema: (m) => new m.Schema({ email: { type: String, required: true } }, { versionKey: false }),
    },
    {
      name: "BenchFailure",
      value: "failure",
      schema: (m) => new m.Schema({ code: { type: Number, required: true }, message: String }, { versionKey: false }),
    },
  ],
  indexes: [{ keys: { actor: 1 } }],
  generate,
});
