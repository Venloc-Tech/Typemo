/*
 * Aggregation fixtures: a small model graph for runtime, shape and hover tests of the
 * pipeline builder. Seeds are plain documents written with the raw driver;
 * they follow the stored form of each class.
 */
import { Decimal128, ObjectId } from "mongodb";
import { type Defaulted, Entity, Index, Prop, type Ref, Schema } from "../../src/index.ts";

/** An order line: a sku with a price, an optional quantity and tags. Embedded in `Order.items`. */
@Schema()
export class LineItem {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  price!: number;

  @Prop(() => Number)
  qty?: number;

  @Prop(() => [String])
  tags?: string[];
}

/** A postal address with a nullable zip code; a nested (dotted-path) subdocument of `Customer`. */
@Schema({ nested: true })
export class PostalAddress {
  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => String, { nullable: true })
  zip!: string | null;
}

/** A customer with an enum tier that has a default, and an optional address. */
@Schema({ collection: "agg_customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String)
  email?: string;

  @Prop(() => String, { enum: ["gold", "silver"], default: "silver" })
  tier!: Defaulted<"gold" | "silver">;

  @Prop(() => PostalAddress)
  address?: PostalAddress;

  @Prop(() => Date, { required: true })
  since!: Date;
}

/**
 * An order that refers to a customer and holds line items. It covers the value / `null` / missing
 * cases (`discount`, `notes`) and the number-like BSON types (`points` as `bigint`, `exact` as Decimal128).
 */
@Schema({ collection: "agg_orders" })
@Index({ status: 1, placedAt: -1 })
export class Order extends Entity {
  @Prop(() => String, { required: true, enum: ["paid", "open"] })
  status!: "paid" | "open";

  @Prop(() => ObjectId, { ref: () => Customer, required: true })
  customer!: Ref<Customer>;

  @Prop(() => [LineItem], { default: [] })
  items!: Defaulted<LineItem[]>;

  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Number, { nullable: true })
  discount?: number | null;

  @Prop(() => Date, { required: true })
  placedAt!: Date;

  @Prop(() => String)
  notes?: string;

  @Prop(() => BigInt)
  points?: bigint;

  @Prop(() => Decimal128)
  exact?: Decimal128;
}

/** An employee that refers to a nullable manager (an employee): the target of `$graphLookup`. */
@Schema({ collection: "agg_employees" })
export class Employee extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => ObjectId, { ref: () => Employee, nullable: true })
  manager!: Ref<Employee> | null;

  @Prop(() => Number, { required: true })
  salary!: number;
}

/** A GeoJSON point. */
@Schema({ nested: true })
export class GeoPoint {
  @Prop(() => String, { enum: ["Point"], required: true })
  type!: "Point";

  @Prop(() => [Number], { required: true })
  coordinates!: number[];
}

/** A named place with a 2dsphere-indexed location: the source of `$geoNear`. */
@Schema({ collection: "agg_places" })
@Index({ location: "2dsphere" })
export class Place extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => GeoPoint, { required: true })
  location!: GeoPoint;
}

/** A sensor reading with a nullable value: the source of `$densify`, `$fill` and window functions. */
@Schema({ collection: "agg_readings" })
export class Reading extends Entity {
  @Prop(() => String, { required: true })
  sensor!: string;

  @Prop(() => Number, { required: true })
  hour!: number;

  @Prop(() => Number, { nullable: true })
  value!: number | null;
}

/** A materialized result: revenue per status (`$out` / `$merge` target, custom `_id`). */
@Schema({ collection: "agg_status_totals" })
export class StatusTotal {
  @Prop(() => String, { required: true })
  _id!: string;

  @Prop(() => Number, { required: true })
  revenue!: number;

  @Prop(() => Number, { required: true })
  orders!: number;
}

/** Seed data, in the stored form of each class. */
export class AggregateSeed {
  static readonly ann = new ObjectId("650000000000000000000001");
  static readonly bob = new ObjectId("650000000000000000000002");
  static readonly cid = new ObjectId("650000000000000000000003");

  static readonly customers = [
    {
      _id: AggregateSeed.ann,
      name: "Ann",
      email: "ann@example.com",
      tier: "gold",
      address: { city: "Oslo", zip: "0150" },
      since: new Date("2020-01-01T00:00:00Z"),
    },
    { _id: AggregateSeed.bob, name: "Bob", tier: "silver", since: new Date("2021-06-01T00:00:00Z") },
    {
      _id: AggregateSeed.cid,
      name: "Cid",
      tier: "silver",
      address: { city: "Rome", zip: null },
      since: new Date("2022-03-15T00:00:00Z"),
    },
  ];

  static readonly orders = [
    {
      _id: new ObjectId("660000000000000000000001"),
      status: "paid",
      customer: AggregateSeed.ann,
      items: [
        { sku: "a", price: 10, qty: 2, tags: ["x", "y"] },
        { sku: "b", price: 5 },
      ],
      total: 25,
      discount: 0.1,
      placedAt: new Date("2024-01-10T10:00:00Z"),
      notes: "$5 off",
      points: 7n,
      exact: Decimal128.fromString("25.00"),
    },
    {
      _id: new ObjectId("660000000000000000000002"),
      status: "open",
      customer: AggregateSeed.ann,
      items: [{ sku: "c", price: 30, qty: 1 }],
      total: 30,
      discount: null,
      placedAt: new Date("2024-02-11T12:30:00Z"),
    },
    {
      _id: new ObjectId("660000000000000000000003"),
      status: "paid",
      customer: AggregateSeed.bob,
      items: [],
      total: 12,
      placedAt: new Date("2024-03-12T08:15:00Z"),
      points: 3n,
    },
  ];

  static readonly boss = new ObjectId("670000000000000000000001");
  static readonly employees = [
    { _id: AggregateSeed.boss, name: "Boss", manager: null, salary: 300 },
    { _id: new ObjectId("670000000000000000000002"), name: "Mid", manager: AggregateSeed.boss, salary: 200 },
    {
      _id: new ObjectId("670000000000000000000003"),
      name: "Dev",
      manager: new ObjectId("670000000000000000000002"),
      salary: 100,
    },
  ];

  static readonly places = [
    {
      _id: new ObjectId("680000000000000000000001"),
      name: "Near",
      location: { type: "Point", coordinates: [10.75, 59.91] },
    },
    {
      _id: new ObjectId("680000000000000000000002"),
      name: "Far",
      location: { type: "Point", coordinates: [12.49, 41.9] },
    },
  ];

  static readonly readings = [
    { _id: new ObjectId("690000000000000000000001"), sensor: "s1", hour: 0, value: 1 },
    { _id: new ObjectId("690000000000000000000002"), sensor: "s1", hour: 2, value: null },
    { _id: new ObjectId("690000000000000000000003"), sensor: "s1", hour: 4, value: 5 },
    { _id: new ObjectId("690000000000000000000004"), sensor: "s2", hour: 1, value: 2 },
  ];
}
