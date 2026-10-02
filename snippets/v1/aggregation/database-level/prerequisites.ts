import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts", softDelete: true })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
