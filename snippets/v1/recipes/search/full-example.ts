import {
  Entity,
  Index,
  Prop,
  Schema,
  SearchIndex,
  ServerError,
  ServerErrorCodes,
  Spec,
  TypemoClient,
  type Vector,
} from "@venloc/typemo";

export class __BadRequest__ extends Error {}
// your code: turns a text into a vector (an embedding model)
declare const __embed__: (text: string) => Promise<number[]>;

// articles/article.ts
@Index({ title: "text", body: "text" })
@SearchIndex({
  name: "embedding_index",
  type: "vectorSearch",
  definition: { fields: [{ type: "vector", path: "embedding", numDimensions: 3, similarity: "cosine" }] },
})
@Schema({ collection: "articles" })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 }))
  embedding?: Vector;
}

export const client = await TypemoClient.connect("mongodb://localhost:27017/help");
const Articles = client.db().model(Article);

// the query comes from a user
const cleanQuery = (text: string): string => {
  const query = text.trim();
  if (query === "" || query.length > 200) throw new __BadRequest__("the query must have 1 to 200 characters");
  return query;
};

// by words: works on any server; the best matches first, sorted by the server
export const searchByWords = (text: string, limit: number) =>
  Articles.find({ $text: { $search: cleanQuery(text) } })
    .textScore("score", { sort: true })
    .limit(limit)
    .select({ title: 1 })
    .plain();

// by sense: Atlas only (not run on the test server)
export const searchBySense = async (text: string, limit: number) => {
  const queryVector = await __embed__(cleanQuery(text));
  return Articles.aggregate((pipeline) =>
    pipeline.vectorSearch({ index: "embedding_index", path: "embedding", queryVector, limit, numCandidates: limit * 10 }),
  ).plain();
};

// sense first, words when the server cannot search by sense
export const search = async (text: string, limit = 10): Promise<{ title: string }[]> => {
  try {
    return await searchBySense(text, limit);
  } catch (error) {
    if (error instanceof ServerError && error.code === ServerErrorCodes.SearchNotEnabled) return searchByWords(text, limit);
    throw error;
  }
};
