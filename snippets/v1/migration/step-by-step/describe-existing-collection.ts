import { Entity, Prop, Schema, Timestamped, TypemoClient, Versioned } from "@venloc/typemo";

@Schema({ collection: "posts" })
export class Post extends Timestamped(Versioned(Entity)) {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number)
  views?: number;

  @Prop(() => [String])
  tags!: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
