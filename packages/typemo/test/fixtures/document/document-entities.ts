/*
 * Root documents for the lifecycle, tracking, versioning, validation, save/bulkSave,
 * JSON forms and rollback tests. `Order` has every kind of field; `Ledger` has full optimistic
 * concurrency; `Tenanted` a shard key; `Hooked` records the order of the document hooks.
 */
import type { Binary, Decimal128, Timestamp } from "mongodb";
import {
  type Computed,
  type Defaulted,
  Entity,
  type Hidden,
  Post,
  PostError,
  Pre,
  Prop,
  Schema,
  Spec,
  Timestamped,
  Types,
  Versioned,
} from "../../../src/index.ts";

/** A nested (dotted-path) address object. */
@Schema({ nested: true })
export class Address {
  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => String)
  street?: string;
}

/** An order line: a sku and a non-negative quantity (an array element of `Order`). */
@Schema()
export class Line extends Entity {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true, min: 0 })
  qty!: number;
}

/** Counts the calls of the `set` of `Order.code` (H508: a setter runs once). */
export class SetterLog {
  static calls = 0;
}

/** Async validator calls of `Order.customer`. */
export class ValidatorLog {
  static calls: string[] = [];
}

/**
 * An order with every kind of field: an async validator, a default, arrays, a subdocument array, a nested
 * object, a Map, an enum, a hidden field, a setter and a getter, and the scalar BSON types.
 */
@Schema({ collection: "d_orders" })
export class Order extends Versioned(Timestamped(Entity)) {
  @Prop(() => String, {
    required: true,
    validate: async (value: string) => {
      ValidatorLog.calls.push(value);
      return value !== "forbidden" || "the customer is forbidden";
    },
  })
  customer!: string;

  @Prop(() => Number, { min: 0, max: 10_000, default: 0 })
  total!: Defaulted<number>;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => [Line])
  lines!: Line[];

  @Prop(() => Address)
  address?: Address;

  @Prop(() => Spec.map(String))
  notes?: Map<string, string>;

  @Prop(() => String, { enum: ["new", "paid"], default: "new" })
  status!: Defaulted<"new" | "paid">;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;

  @Prop(() => String, {
    set: (value: string) => {
      SetterLog.calls++;
      return value.toLowerCase();
    },
  })
  code?: string;

  @Prop(() => Number, { get: (value: number) => Math.round(value) })
  discount?: number;

  @Prop(() => BigInt)
  views?: bigint;

  @Prop(() => Types.Decimal128)
  price?: Decimal128;

  @Prop(() => Types.Timestamp)
  seenAt?: Timestamp;

  @Prop(() => Types.Binary)
  blob?: Binary;

  @Prop(() => RegExp)
  pattern?: RegExp;

  get label(): Computed<string> {
    /* cast: brands the string as Computed */
    return `${this.customer}#${this.tags.length}` as Computed<string>;
  }

  /** A method: hydrated documents keep the class's methods. */
  describe(): string {
    return `order of ${this.customer}`;
  }
}

/** A ledger with full optimistic concurrency. */
@Schema({ collection: "d_ledgers", optimisticConcurrency: true })
export class Ledger extends Versioned(Entity) {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { required: true })
  balance!: number;
}

/** A document with a shard key (`region`). */
@Schema({ collection: "d_tenanted", shardKey: { region: 1 } })
export class Tenanted extends Entity {
  @Prop(() => String, { required: true })
  region!: string;

  @Prop(() => String, { required: true })
  name!: string;
}

/** A document with no versioning, timestamps or hooks. */
@Schema({ collection: "d_plain" })
export class PlainDoc extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => [String])
  tags?: string[];
}

/** The order in which the document hooks of `Hooked` ran. */
export class HookLog {
  static lines: string[] = [];
}

/** A document whose hooks write to `HookLog`; its pre-save hook edits the document. */
@Schema({ collection: "d_hooked" })
export class Hooked extends Entity {
  @Prop(() => String, { required: true, validate: (value: string) => value !== "invalid" || "invalid name" })
  name!: string;

  @Prop(() => String)
  stamp?: string;

  @Pre("document.save")
  beforeSave(this: Hooked): void {
    HookLog.lines.push(`pre save ${this.name}`);
    /* a change made by a pre('save') hook is validated and saved */
    if (this.name === "fix-me") this.name = "fixed";
    if (this.name === "break-me") this.name = "invalid";
    this.stamp = "stamped";
  }

  @Pre("document.validate")
  beforeValidate(this: Hooked): void {
    HookLog.lines.push(`pre validate ${this.name}`);
  }

  @Post("document.validate")
  afterValidate(this: Hooked): void {
    HookLog.lines.push("post validate");
  }

  @Post("document.save")
  afterSave(this: Hooked): void {
    HookLog.lines.push(`post save ${this.name}`);
  }

  @PostError("document.save")
  failedSave(this: Hooked, error: unknown): void {
    HookLog.lines.push(`postError save ${(error as Error).name}`);
  }

  @Pre("document.deleteOne")
  beforeDelete(this: Hooked): void {
    HookLog.lines.push(`pre deleteOne ${this.name}`);
  }
}
