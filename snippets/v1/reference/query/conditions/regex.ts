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
const ab = await Members.find().where("name").regex(/^[AB]/).sort({ name: 1 }).plain();
console.log(ab.map((member) => member.name));
// → ["Alice", "Bob"]
