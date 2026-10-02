import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { expectIndexScan, explainIndexUsage } from "@venloc/typemo/testing";

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

// your code: the application log
declare const __log__: (message: string) => void;

export const createArticles = (client: TypemoClient) => {
  const Articles = client.db().model(Article);

  // a production query: a label for the server log and a time limit
  const popular = () =>
    Articles.find({ views: { $gt: 10 } })
      .comment("articles: popular list")
      .timeoutMS(2_000)
      .sort({ views: -1 })
      .plain();

  // diagnostics: does the query read the whole collection
  const diagnose = async () => {
    const usage = await explainIndexUsage(Articles.find({ views: { $gt: 10 } }));
    __log__(`stages: ${usage.stages.join(" > ")}; examined ${usage.docsExamined}, returned ${usage.docsReturned}`);
  };

  // a test check: the query must use an index
  const assertIndexed = () => expectIndexScan(Articles.find({ views: { $gt: 10 } }), { index: "views_1" });

  return { popular, diagnose, assertIndexed };
};
