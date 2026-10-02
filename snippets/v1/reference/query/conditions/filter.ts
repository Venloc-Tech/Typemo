import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { enum: ["user", "editor", "admin"], required: true }) role!: "user" | "editor" | "admin";
  @Prop(() => String) nickname?: string;
  @Prop(() => Number) age?: number;
  @Prop(() => [String]) tags!: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Members = client.db().model(Member);
// ---cut---
const query = Members.find({ role: "admin" }).where("age").gte(17).lt(30);
console.log(query.filter());
// → { role: "admin", age: { $gte: 17, $lt: 30 } }
