import { Entity, Prop, Schema, SearchIndex, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "articles" })
@SearchIndex({ name: "articles_text", definition: { mappings: { dynamic: true } } })
class Article extends Entity {
  @Prop(() => String, { required: true })
  body!: string;
}

const deploy = async (uri: string) => {
  const client = await TypemoClient.connect(uri, { name: "deploy" });
  try {
    const Articles = client.connection.model(Article);

    // plan: what will be created, writing nothing
    const plan = await Articles.syncSearchIndexes({ dryRun: true });
    console.log("to create:", plan.toCreate);

    // apply: creates, updates and drops; on failure throws IndexSyncError
    await Articles.syncSearchIndexes();
  } finally {
    await client.close();
  }
};

await deploy("mongodb://localhost:27017/app");
