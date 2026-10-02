import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts", softDelete: true }) // [!code highlight]
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => String, { hidden: true })
  pin?: Hidden<string>;

  @Prop(() => Date, { nullable: true }) // [!code ++]
  deletedAt?: Date | null; // [!code ++]
}
