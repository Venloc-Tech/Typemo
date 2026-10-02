import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts", softDelete: true })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Posts = client.connection.model(Post);
// ---cut---
const live = await Posts.find().sort({ title: 1 }).select({ title: 1 }).plain();
// → ["One", "Three"]

const trash = await Posts.find().policy({ onlyDeleted: true }).plain();
console.log(trash[0]?.title, trash[0]?.deletedAt instanceof Date);
// → "Two" true

const everything = await Posts.find().policy({ includeDeleted: true }).select({ title: 1 }).plain();
// → all three
