import { Entity, type Hidden, Prop, type Projection, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class Comment {
  @Prop(() => String, { required: true }) author!: string;
  @Prop(() => String, { required: true }) text!: string;
  @Prop(() => Number, { required: true }) likes!: number;
}
@Schema({ collection: "articles" })
class Article extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
  @Prop(() => Number, { required: true }) views!: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Comment]) comments!: Comment[];
  @Prop(() => String, { hidden: true }) editorNote?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Articles = client.db().model(Article);
// ---cut---
export const pick = (id: string, fields: Projection<Article>) =>
  Articles.findById(id).select(fields).plain().orFail();

const intro = await Articles.findOne({ title: "Intro" }).plain().orFail();
const card = await pick(intro._id, { title: 1, views: 1 });
//    ^?
// → { _id: "…", title: "Intro", views: 120 }
declare const fields: Record<string, 0 | 1>;
const doc = await Articles.findOne({ title: "Intro" }).select(fields).orFail();
//    ^?
