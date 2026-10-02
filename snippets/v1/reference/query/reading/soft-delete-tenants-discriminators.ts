import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "accounts", softDelete: true })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}

const Accounts = client.db().model(Account);

await Accounts.estimatedDocumentCount(); // [!code error]
