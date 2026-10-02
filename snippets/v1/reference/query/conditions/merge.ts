import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { enum: ["user", "editor", "admin"], required: true }) role!: "user" | "editor" | "admin";
  @Prop(() => String) nickname?: string;
  @Prop(() => Number) age?: number;
  @Prop(() => [String]) tags!: string[];
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Members = client.db().model(Member);
const Posts = client.db().model(Post);
// ---cut---
const admins = Members.find({ role: "admin" });
const found = await Members.find({ age: 30 }).merge(admins).plain();
console.log(found.map((member) => member.name));
// → ["Alice"]

const sameWithFilter = await Members.find({ age: 30 }).merge({ role: "admin" }).plain();
console.log(sameWithFilter.map((member) => member.name));
// → ["Alice"]
