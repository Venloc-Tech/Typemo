import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ views: 1 })
@Schema({ collection: "articles" })
class Article extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) body!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Articles = client.db().model(Article);
// ---cut---
try {
  await Articles.find().timeoutMS(1).plain();
} catch (error) {
  console.log(String(error));
  // → "TimeoutError: operation timed out (timeoutMS): Server reported a timeout error"
}
