import { Entity, Prop, Schema, Versioned } from "@venloc/typemo";

@Schema({ collection: "accounts", optimisticConcurrency: true })
export class Account extends Versioned(Entity) {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  balance!: number;
}
