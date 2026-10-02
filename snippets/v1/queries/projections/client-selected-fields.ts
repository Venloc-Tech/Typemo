import { Entity, type Hidden, Prop, Schema, TypemoClient, untrusted } from "@venloc/typemo";
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
// your code: parse ?fields=title,views into a map { title: 1, views: 1 }
declare const __parseFields__: (raw: string) => Record<string, 0 | 1>;

export const listArticles = (rawFields: string) =>
  Articles.find().select(untrusted(__parseFields__(rawFields), "projection")).plain();

const rows = await listArticles("title,views");
//    ^?
// → [{ _id: "…", title: "Intro", views: 120 }]
