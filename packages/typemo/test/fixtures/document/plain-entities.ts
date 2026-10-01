/*
 * The fixtures of the plain form. `AllForms` holds every BSON type of the table (int64 beyond 2^53,
 * the three vector dtypes, Binary, UUID, Decimal128, Timestamp, RegExp), `null` against a missing field, nested
 * arrays, arrays of subdocuments, a Map of subdocuments, a `Hidden` field, a getter virtual and a reference populated
 * on two levels (`owner` → `Holder.boss`, whose own Map of subdocuments and `Hidden` field show that a populated
 * document is walked by its own schema). `Signal` / `Pulse` is a root discriminator.
 */
import type { Binary, Decimal128, ObjectId, Timestamp, UUID } from "mongodb";
import {
  type Computed,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Hidden,
  Prop,
  type Ref,
  Schema,
  Spec,
  Types,
  type Vector,
  Virtual,
  type VirtualRef,
} from "../../../src/index.ts";

/** A subdocument with a number, an optional bigint and an optional ObjectId. */
@Schema()
export class Spot {
  @Prop(() => Number, { required: true })
  x!: number;

  @Prop(() => BigInt)
  weight?: bigint;

  @Prop(() => Types.ObjectId)
  marker?: ObjectId;
}

/** A holder: a bigint, a Map of subdocuments, a hidden `pin` and a reference to its boss (another holder). */
@Schema({ collection: "r21_holders" })
export class Holder extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => BigInt)
  score?: bigint;

  @Prop(() => Spec.map(Spot))
  spots?: Map<string, Spot>;

  @Prop(() => String, { hidden: true })
  pin?: Hidden<string>;

  @Prop(() => Types.ObjectId, { ref: () => Holder })
  boss?: Ref<Holder>;
}

/** A document with every BSON type and every container kind: the same data in every output form. */
@Schema({ collection: "r21_all_forms" })
export class AllForms extends Entity {
  @Prop(() => String, { required: true })
  str!: string;

  @Prop(() => Number)
  num?: number;

  @Prop(() => Types.Int32)
  i32?: number;

  @Prop(() => BigInt)
  long?: bigint;

  @Prop(() => Types.Decimal128)
  dec?: Decimal128;

  @Prop(() => Boolean)
  bool?: boolean;

  @Prop(() => Date)
  date?: Date;

  @Prop(() => Types.Binary)
  bin?: Binary;

  @Prop(() => Types.UUID)
  uuid?: UUID;

  @Prop(() => Spec.vector({ dtype: "int8" }))
  vInt8?: Vector;

  @Prop(() => Spec.vector({ dtype: "float32" }))
  vFloat32?: Vector;

  @Prop(() => Spec.vector({ dtype: "packedBit" }))
  vBits?: Vector;

  @Prop(() => RegExp)
  re?: RegExp;

  @Prop(() => Types.Timestamp)
  ts?: Timestamp;

  @Prop(() => String, { nullable: true })
  nil?: string | null;

  @Prop(() => String)
  missing?: string;

  @Prop(() => [[BigInt]])
  grid!: bigint[][];

  @Prop(() => [Spot])
  spots!: Spot[];

  @Prop(() => Spec.map(Spot))
  spotsByName?: Map<string, Spot>;

  @Prop(() => Spec.map(Types.Decimal128))
  prices?: Map<string, Decimal128>;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;

  @Prop(() => Types.ObjectId, { ref: () => Holder })
  owner?: Ref<Holder>;

  @Prop(() => [Types.ObjectId], { ref: () => Holder })
  holders!: Ref<Holder>[];

  @Prop(() => Spec.map(Types.ObjectId), { ref: () => Holder })
  holdersByRole?: Map<string, Ref<Holder>>;

  @Virtual({ ref: () => Holder, localField: "holders", foreignField: "_id" })
  holderDocs?: VirtualRef<Holder>;

  get summary(): Computed<string> {
    /* cast: brands the string as Computed */
    return `${this.str}:${String(this.long)}` as Computed<string>;
  }
}

/** The base of the `Pulse` root discriminator. */
@Schema({ collection: "r21_signals" })
export class Signal extends Entity {
  @Prop(() => String, { required: true })
  label!: string;
}

/** A `Signal` discriminator with a bigint energy and a Map of ObjectIds. */
@Discriminator("pulse")
export class Pulse extends Signal {
  declare readonly __t: DiscriminatorValue<"pulse">;

  @Prop(() => BigInt, { required: true })
  energy!: bigint;

  @Prop(() => Spec.map(Types.ObjectId))
  sources?: Map<string, ObjectId>;
}

/**
 * A locker: a subdocument with a `Hidden` code. `Hidden` fields below the root are covered in a single
 * subdocument, an array of subdocuments, a Map of subdocuments, and in a populated document
 * (`Vault.keeper`, a `Holder` with its `Hidden` `pin`).
 */
@Schema()
export class Locker {
  @Prop(() => String, { required: true })
  label!: string;

  @Prop(() => String, { hidden: true })
  code?: Hidden<string>;
}

/** A vault: lockers in a single field, an array and a Map, and a populated keeper. */
@Schema({ collection: "r26_vaults" })
export class Vault extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Locker)
  main?: Locker;

  @Prop(() => [Locker])
  lockers!: Locker[];

  @Prop(() => Spec.map(Locker))
  byRoom?: Map<string, Locker>;

  @Prop(() => Types.ObjectId, { ref: () => Holder })
  keeper?: Ref<Holder>;
}
