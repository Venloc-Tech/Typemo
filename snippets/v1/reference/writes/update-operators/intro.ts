import { type Defaulted, Entity, type Immutable, Prop, Schema, Spec } from "@venloc/typemo";

@Schema()
export class Line {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;
}

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { min: 0, default: 0 })
  balance!: Defaulted<number>;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => String)
  note?: string;

  @Prop(() => String)
  nickname?: string;

  @Prop(() => String)
  alias?: string;

  @Prop(() => Date)
  lastLogin?: Date;

  @Prop(() => Number)
  flags?: number;

  @Prop(() => BigInt)
  points?: bigint;

  @Prop(() => [Number])
  scores!: number[];

  @Prop(() => [Line])
  lines!: Line[];

  @Prop(() => Spec.map(Number))
  counters?: Map<string, number>;

  @Prop(() => String, { immutable: true })
  region?: Immutable<string>;
}
