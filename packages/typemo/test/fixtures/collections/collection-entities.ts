/*
 * Entities of the typed-collection tests: every element kind a tracked collection holds —
 * scalars, BSON values, nested arrays, subdocuments with and without `_id`, a custom `_id`, nested
 * objects, embedded discriminators and Maps of scalars, subdocuments and arrays.
 */
import { Binary, Decimal128, ObjectId, UUID } from "mongodb";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Prop,
  type Ref,
  Schema,
  Spec,
  Types,
} from "../../../src/index.ts";

/** A subdocument with an `_id`, tags, seats, shapes and every container kind (an element of `Doc.revisions`). */
@Schema()
export class Revision extends Entity {
  @Prop(() => String) note!: string;
  @Prop(() => Number) lines!: number;
  @Prop(() => [String]) tags?: string[];
  @Prop(() => String, { dbName: "cm" }) comment?: string;

  /** A method of the entity class: must work on hydrated subdocuments. */
  summary(): string {
    return `${this.note}:${this.lines}`;
  }
}

/** A subdocument class without `_id`. */
@Schema()
export class Point {
  @Prop(() => Number) x!: number;
  @Prop(() => Number) y!: number;
}

/** A subdocument class with a custom numeric `_id` (H100). */
@Schema()
export class Seat {
  @Prop(() => Number) _id!: number;
  @Prop(() => String) label!: string;
}

/** A nested (dotted-path) name object. */
@Schema({ nested: true })
export class FullName {
  @Prop(() => String) first!: string;
  @Prop(() => String) last?: string;
}

/** A single subdocument with an `_id` and an array of lines. */
@Schema()
export class Address extends Entity {
  @Prop(() => String) city!: string;
  @Prop(() => [String]) lines?: string[];
}

/** The base of the embedded `Circle` / `Square` discriminators (key `kind`). */
@Schema({ discriminatorKey: "kind" })
export class Shape {
  @Prop(() => String) kind!: string;
  @Prop(() => String) color?: string;
}

/** A `Shape` discriminator with a radius. */
@Discriminator("circle")
export class Circle extends Shape {
  declare readonly kind: DiscriminatorValue<"circle">;
  @Prop(() => Number) radius!: number;
}

/** A `Shape` discriminator with a side length. */
@Discriminator("square")
export class Square extends Shape {
  declare readonly kind: DiscriminatorValue<"square">;
  @Prop(() => Number) side!: number;
}

/** A badge: the value of a Map of subdocuments, with a lowercased code. */
@Schema()
export class Badge {
  @Prop(() => String) title!: string;
  @Prop(() => Number) level?: number;
  @Prop(() => [Number]) marks?: number[];
  @Prop(() => String, { lowercase: true }) code?: string;
}

/** An owner: the target of `Doc.owners`. */
@Schema({ collection: "c_owners" })
export class Owner extends Entity {
  @Prop(() => String) name?: string;
}

/** The test document: one field per kind of tracked collection. */
@Schema({ collection: "c_docs" })
export class Doc extends Entity {
  @Prop(() => [String]) tags?: string[];
  @Prop(() => [Number]) nums?: number[];
  @Prop(() => [Types.ObjectId], { ref: () => Owner }) owners?: Ref<Owner>[];
  @Prop(() => [Date]) dates?: Date[];
  @Prop(() => [Types.Decimal128]) prices?: Decimal128[];
  @Prop(() => [BigInt]) bigs?: bigint[];
  @Prop(() => [Types.UUID]) uuids?: UUID[];
  @Prop(() => [Types.Binary]) blobs?: Binary[];
  @Prop(() => [[Number]]) matrix?: number[][];
  @Prop(() => [String], { nullable: true }) maybe?: string[] | null;
  @Prop(() => [Revision]) revisions?: Revision[];
  @Prop(() => [Point]) points?: Point[];
  @Prop(() => [Seat]) seats?: Seat[];
  @Prop(() => [Shape]) shapes?: (Circle | Square)[];
  @Prop(() => Address) address?: Address;
  @Prop(() => FullName) fullName?: FullName;
  @Prop(() => Spec.map(Number)) scores?: Map<string, number>;
  @Prop(() => Spec.map(Badge)) badges?: Map<string, Badge>;
  @Prop(() => Spec.map([Number])) series?: Map<string, number[]>;
  @Prop(() => [String], { dbName: "lb" }) labels?: string[];
  @Prop(() => [[Point]]) grid?: Point[][];
}

/** Fixed ids so expected updates can be written literally. */
export const IDS = {
  doc: new ObjectId("660000000000000000000001"),
  rev: [
    new ObjectId("660000000000000000000011"),
    new ObjectId("660000000000000000000012"),
    new ObjectId("660000000000000000000013"),
  ],
  owner: [new ObjectId("660000000000000000000021"), new ObjectId("660000000000000000000022")],
  address: new ObjectId("660000000000000000000031"),
} as const;

/** The stored seed (database form) of the test document. */
export const seed = (): Record<string, unknown> => ({
  _id: IDS.doc,
  tags: ["a", "b", "c"],
  nums: [1, 2, 3],
  owners: [...IDS.owner],
  dates: [new Date("2020-01-01T00:00:00Z"), new Date("2021-01-01T00:00:00Z")],
  prices: [Decimal128.fromString("1.5"), Decimal128.fromString("2.5")],
  bigs: [1n, 2n],
  uuids: [new UUID("00000000-0000-4000-8000-000000000001"), new UUID("00000000-0000-4000-8000-000000000002")],
  blobs: [new Binary(new Uint8Array([1, 2]))],
  matrix: [
    [1, 2],
    [3, 4],
  ],
  maybe: ["x"],
  revisions: IDS.rev.map((_id, index) => ({ _id, note: `n${index}`, lines: index, tags: [`t${index}`] })),
  points: [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ],
  seats: [
    { _id: 5, label: "A5" },
    { _id: 6, label: "A6" },
  ],
  shapes: [
    { kind: "circle", radius: 1, color: "red" },
    { kind: "square", side: 2 },
  ],
  address: { _id: IDS.address, city: "Oslo", lines: ["street 1"] },
  fullName: { first: "Ann", last: "Lee" },
  scores: { math: 5, art: 3 },
  badges: { gold: { title: "Gold", level: 3, marks: [1, 2] } },
  series: { a: [1, 2] },
  grid: [[{ x: 0, y: 0 }], []],
});
