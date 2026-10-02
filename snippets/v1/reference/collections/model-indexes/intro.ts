import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Index({ opened: 1 }, { name: "opened_ttl", expireAfterSeconds: 3600 })
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true, index: true })
  owner!: string;

  @Prop(() => Date)
  opened?: Date;
}
