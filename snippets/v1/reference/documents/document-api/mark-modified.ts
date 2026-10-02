import { Entity, Prop, Schema, TypemoClient, Types } from "@venloc/typemo";
import type { Binary } from "mongodb";
@Schema({ collection: "files" })
class StoredFile extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Types.Binary) data?: Binary;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Files = client.db().model(StoredFile);
const file = await Files.findOne({ name: "logo" }).orFail();
// ---cut---
file.data!.buffer[0] = 9;
console.log(file.$isModified("data"));
// → false

file.$markModified("data");
console.log(file.$isModified("data"), Object.keys(file.$getChanges()));
// → true ["$set"]
