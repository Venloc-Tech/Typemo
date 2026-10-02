import { Entity, type Defaulted, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users", validator: true })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3 })
  name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
await client.db().init();
const [info] = await client.unsafeDriver().db("app").listCollections({ name: "users" }, { nameOnly: false }).toArray();
console.log(JSON.stringify(info?.options?.validator));
// → {"$jsonSchema":{"bsonType":"object","properties":{"_id":{"bsonType":"objectId"},"name":{"bsonType":"string","minLength":3},"role":{"bsonType":"string","enum":["user","admin"]}},"required":["_id","name"],"additionalProperties":false}}
