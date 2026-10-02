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
const lean = await Articles.findOne({ title: "Intro" }).lean().orFail();
console.log("editorNote" in lean);
// → false
