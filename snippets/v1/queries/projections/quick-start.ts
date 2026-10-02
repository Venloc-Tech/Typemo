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
const included = await Articles.findOne({ title: "Intro" }).select({ title: 1, views: 1 }).plain().orFail();
//    ^?
// → { _id: "…", title: "Intro", views: 120 }

const excluded = await Articles.findOne({ title: "Intro" }).select({ body: 0, comments: 0 }).plain().orFail();
// → { _id: "…", title: "Intro", views: 120, tags: ["news", "typemo", "mongo"] }

const noId = await Articles.findOne({ title: "Intro" }).select({ title: 1, _id: 0 }).plain().orFail();
// → { title: "Intro" }
