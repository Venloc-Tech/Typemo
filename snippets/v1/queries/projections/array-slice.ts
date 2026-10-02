import { Entity, type Hidden, Prop, type Selected, Schema, TypemoClient } from "@venloc/typemo";
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
const first = await Articles.findOne({ title: "Intro" }).select({ title: 1, comments: { $slice: 2 } }).plain().orFail();
// → { _id: "…", title: "Intro", comments: [ { author: "bob", … }, { author: "eve", … } ] }

const last = await Articles.findOne({ title: "Intro" }).select({ title: 1, tags: { $slice: -1 } }).plain().orFail();
// → { _id: "…", title: "Intro", tags: ["mongo"] }

const middle = await Articles.findOne({ title: "Intro" }).select({ title: 1, tags: { $slice: [1, 1] } }).plain().orFail();
// → { _id: "…", title: "Intro", tags: ["typemo"] }
