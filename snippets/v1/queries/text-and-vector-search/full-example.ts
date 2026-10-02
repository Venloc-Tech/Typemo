import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Index({ title: "text", body: "text" })
@Index({ views: 1 })
@Schema({ collection: "articles" })
class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Number, { required: true })
  views!: number;
}

// your code: parsing the search string from an HTTP request
declare const __cleanQuery__: (raw: string) => string;

export const createSearch = (client: TypemoClient) => {
  const Articles = client.db().model(Article);

  // word search: best first, the database sorts, the limit cuts the worst
  const search = async (raw: string, minViews = 0) => {
    const found = await Articles.find({ $text: { $search: __cleanQuery__(raw) }, views: { $gte: minViews } })
      .textScore("score", { sort: true })
      .limit(50)
      .plain();
    return found.map((article) => ({ title: article.title, score: article.score }));
  };

  // search without a word: a minus before a word excludes documents with it
  const searchWithout = (word: string, without: string) =>
    Articles.find({ $text: { $search: `${word} -${without}` } }).plain();

  return { search, searchWithout };
};
