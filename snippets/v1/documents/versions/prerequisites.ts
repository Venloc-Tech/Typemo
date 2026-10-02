import { Entity, Prop, Schema, Versioned } from "@venloc/typemo";

@Schema({ collection: "ledgers", optimisticConcurrency: true })
export class Ledger extends Versioned(Entity) {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { required: true })
  balance!: number;
}
