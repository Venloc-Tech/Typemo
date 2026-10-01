import type { CreateInput, EntityClass, Model } from "@venloc/typemo";
import type { Collection, CreateIndexesOptions, Document, IndexDirection, ObjectId } from "mongodb";
import type mongoose from "mongoose";
import type { DriverHandle, MongooseHandle, TypemoHandle } from "../../adapters/bench-context.ts";
import { SIZE_COUNTS, type SizeName } from "../../harness/types.ts";
import { Ids, Rng } from "../rng.ts";

/**
 * One index every contestant gets.
 *
 * @example
 * ```ts
 * const index: IndexSpec = { keys: { email: 1 }, options: { unique: true } };
 * ```
 */
export interface IndexSpec {
  /** The index key. */
  readonly keys: Readonly<Record<string, IndexDirection>>;
  /** Index options. */
  readonly options?: CreateIndexesOptions;
}

/**
 * A Mongoose discriminator of a shape.
 *
 * @example
 * ```ts
 * const discriminator: MongooseDiscriminator = {
 *   name: "Click",
 *   value: "click",
 *   schema: (m) => new m.Schema({ x: Number }),
 * };
 * ```
 */
export interface MongooseDiscriminator {
  /** The discriminator model name. */
  readonly name: string;
  /** The stored discriminator value. */
  readonly value: string;
  /** Builds its schema with the given Mongoose instance. */
  readonly schema: (m: mongoose.Mongoose) => mongoose.Schema;
}

/**
 * Everything needed to build the equivalent models and data of one shape.
 *
 * @example
 * ```ts
 * const spec: ShapeSpec<Flat> = {
 *   name: "flat",
 *   namespace: 1,
 *   collection: "bench_flat",
 *   entity: Flat,
 *   mongooseName: "BenchFlat",
 *   mongooseSchema: (m) => new m.Schema({ name: String }),
 *   indexes: [],
 *   generate: (i) => ({ name: `n${i}` }),
 * };
 * ```
 */
export interface ShapeSpec<E extends object> {
  /** Short name used in dataset markers and reports. */
  readonly name: string;
  /** 32-bit namespace of the deterministic `_id`s (Ids.of). Unique per shape. */
  readonly namespace: number;
  /** The collection name. */
  readonly collection: string;
  /** The Typemo entity class. */
  readonly entity: EntityClass<E>;
  /** Mongoose model name (unique per shape). */
  readonly mongooseName: string;
  /** Builds the Mongoose schema with the given Mongoose instance. */
  readonly mongooseSchema: (m: mongoose.Mongoose) => mongoose.Schema;
  /** Mongoose discriminators, when the shape has any. */
  readonly mongooseDiscriminators?: readonly MongooseDiscriminator[];
  /** The same indexes every contestant gets (created by Datasets with the driver). */
  readonly indexes: readonly IndexSpec[];
  /**
   * The INPUT form of document `i` (what a user passes to create/insert): without the fields that have schema
   * defaults, without timestamps. `rng` is seeded from the shape and `i`.
   */
  readonly generate: (i: number, rng: Rng) => Document;
  /**
   * The STORED form the raw driver must write to reach the same DB state as the ODMs: applies schema defaults
   * (and nothing else — timestamps are the scenario's business). Default: identity.
   */
  readonly complete?: (input: Document) => Document;
  /** Documents per size when the standard counts would be absurd for this shape (e.g. 1 MB binaries). */
  readonly counts?: Partial<Record<SizeName, number>>;
}

/**
 * One document shape with equivalent models for every contestant: a Typemo entity, a Mongoose
 * schema, the driver collection, and the SAME index list. Deterministic generator: `doc(i)` is identical on
 * every run and for every contestant.
 */
export class ShapeDef<E extends object> {
  /**
   * @param spec - The shape description.
   */
  constructor(readonly spec: ShapeSpec<E>) {}

  /** The shape name. */
  get name(): string {
    return this.spec.name;
  }

  /** The collection name. */
  get collection(): string {
    return this.spec.collection;
  }

  /** The Typemo entity class. */
  get entity(): EntityClass<E> {
    return this.spec.entity;
  }

  /**
   * Documents in the dataset of a size.
   *
   * @param size - The dataset size.
   * @returns The shape's own count for the size, or the standard one.
   */
  countFor(size: SizeName): number {
    return this.spec.counts?.[size] ?? SIZE_COUNTS[size];
  }

  /**
   * The deterministic `_id` of document `i`.
   *
   * @param i - The document index.
   * @returns The id.
   */
  id(i: number): ObjectId {
    return Ids.of(this.spec.namespace, i);
  }

  /**
   * Input form of document `i`, with its deterministic `_id`.
   *
   * @param i - The document index.
   * @returns The input document.
   */
  input(i: number): Document {
    return { _id: this.id(i), ...this.spec.generate(i, new Rng(Rng.seedOf(this.spec.namespace, i))) };
  }

  /**
   * Input form WITHOUT `_id` (for scenarios that let the ODM generate ids).
   *
   * @param i - The document index.
   * @returns The input document.
   */
  inputNoId(i: number): Document {
    return this.spec.generate(i, new Rng(Rng.seedOf(this.spec.namespace, i)));
  }

  /**
   * Stored form of document `i` (input + schema defaults).
   *
   * @param i - The document index.
   * @returns The stored document.
   */
  stored(i: number): Document {
    const input = this.input(i);
    return this.spec.complete === undefined ? input : this.spec.complete(input);
  }

  /**
   * Input forms of several documents.
   *
   * @param from - The first index.
   * @param count - How many documents.
   * @returns The input documents.
   */
  inputs(from: number, count: number): Document[] {
    const out: Document[] = [];
    for (let i = from; i < from + count; i++) out.push(this.input(i));
    return out;
  }

  /**
   * Stored forms of several documents.
   *
   * @param from - The first index.
   * @param count - How many documents.
   * @returns The stored documents.
   */
  storedMany(from: number, count: number): Document[] {
    const out: Document[] = [];
    for (let i = from; i < from + count; i++) out.push(this.stored(i));
    return out;
  }

  /**
   * Typemo's create input. The generator is untyped on purpose (shared by all contestants).
   *
   * @param doc - An input document.
   * @returns The same object, typed as the create input.
   */
  typemoInput(doc: Document): CreateInput<E> {
    return doc as unknown as CreateInput<E>;
  }

  /**
   * Typemo's create inputs.
   *
   * @param docs - Input documents.
   * @returns The same objects, typed as create inputs.
   */
  typemoInputs(docs: readonly Document[]): CreateInput<E>[] {
    return docs as unknown as CreateInput<E>[];
  }

  /**
   * The driver collection of the shape.
   *
   * @param handle - The driver contestant.
   * @returns The collection.
   */
  driver(handle: DriverHandle): Collection<Document> {
    return handle.db.collection(this.spec.collection);
  }

  /**
   * The Mongoose model of the shape, with its discriminators.
   *
   * @param handle - A Mongoose contestant.
   * @returns The model.
   */
  mongoose(handle: MongooseHandle): mongoose.Model<Record<string, unknown>> {
    const model = handle.model(this.spec.mongooseName, this.spec.collection, this.spec.mongooseSchema);
    for (const d of this.spec.mongooseDiscriminators ?? []) {
      if (model.discriminators?.[d.name] === undefined) model.discriminator(d.name, d.schema(handle.instance), d.value);
    }
    return model;
  }

  /**
   * The Mongoose discriminator model of `name` (after `mongoose(handle)`).
   *
   * @param handle - A Mongoose contestant.
   * @param name - The discriminator model name.
   * @returns The model.
   * @throws Error - When the shape has no such discriminator.
   */
  mongooseDiscriminator(handle: MongooseHandle, name: string): mongoose.Model<Record<string, unknown>> {
    const model = this.mongoose(handle).discriminators?.[name];
    if (model === undefined) throw new Error(`${this.name}: no Mongoose discriminator ${name}`);
    return model as mongoose.Model<Record<string, unknown>>;
  }

  /**
   * The Typemo model of the shape.
   *
   * @param handle - A Typemo contestant.
   * @returns The model.
   */
  typemo(handle: TypemoHandle): Model<E> {
    return handle.model(this.spec.entity);
  }
}
