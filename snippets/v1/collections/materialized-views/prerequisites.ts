import { Entity, EntityWithId, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { required: true })
  balance!: number;

  @Prop(() => Boolean, { required: true })
  closed!: boolean;
}

@Schema({ collection: "owner_totals" })
export class OwnerTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Number, { required: true })
  count!: number;
}
