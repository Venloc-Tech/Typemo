import { type Computed, Entity, type Hidden, Prop, Schema, Spec, Versioned } from "@venloc/typemo";

@Schema({ collection: "invoices" })
export class Invoice extends Versioned(Entity) {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => Date)
  issuedAt?: Date;

  @Prop(() => BigInt)
  points?: bigint;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Spec.map(Number))
  fees?: Map<string, number>;

  @Prop(() => String, { hidden: true })
  note?: Hidden<string>;

  @Prop(() => Number, { get: (value: number) => Math.round(value) })
  discount?: number;

  get label(): Computed<string> {
    return `${this.customer}#${this.tags.length}` as Computed<string>;
  }
}
