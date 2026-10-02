import { Entity, Prop, Schema, TypemoClient, UnknownFieldsError } from "@venloc/typemo";
@Schema()
class Line {
  @Prop(() => String, { required: true }) sku!: string;
}
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [Line]) lines!: Line[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const id = (await Accounts.findOne().orFail())._id;
// ---cut---
const account = await Accounts.findById(id).orFail();
account.lines.set(0, { sku: "z" });

try {
  await account.$save();
} catch (error) {
  if (error instanceof UnknownFieldsError) {
    console.log(error.message);
    // → the save would drop fields the schema does not know from stored data: "lines.0" (legacy); migrate the data or the schema, or pass { dropUnknownFields: true } to $save()/bulkSave() to accept the loss
    console.log(error.fields);
    // → [{ path: "lines.0", keys: ["legacy"] }]
  }
}
