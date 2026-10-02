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
// a list for a page: only the needed fields, the last two comments
export const listArticles = () =>
  Articles.find()
    .sort({ views: -1 })
    .limit(20)
    .select({ title: 1, views: 1, comments: { $slice: -2 } })
    .plain();

// an article card with a declared response type
export type ArticlePreview = Selected<Article, "title" | "views">;
export const previewArticle = (idFromUrl: string): Promise<ArticlePreview> =>
  Articles.findById(idFromUrl).select({ title: 1, views: 1 }).plain().orFail();

// export without the id
export const exportTitles = () => Articles.find().select({ title: 1, _id: 0 }).plain();

// internal service: the editor's note is needed, return it explicitly
export const forEditors = (idFromUrl: string) =>
  Articles.findById(idFromUrl).select({ "+editorNote": true }).plain({ hidden: true }).orFail();
