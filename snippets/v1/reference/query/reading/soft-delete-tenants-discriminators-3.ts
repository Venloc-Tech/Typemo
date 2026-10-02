import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "accounts", softDelete: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const Accounts = client.db().model(Account);
// ---cut---
const withDeleted = await Accounts.estimatedDocumentCount().policy({ includeDeleted: true });
// → 3 (two live records and one deleted)
