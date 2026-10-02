import { Entity, Prop, Schema, Timestamped, TypemoClient, Versioned } from "@venloc/typemo";

@Schema({ collection: "posts", optimisticConcurrency: true })
class Post extends Timestamped(Versioned(Entity)) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [String]) tags!: string[];
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Posts = client.db().model(Post);

// create: timestamps and version are set automatically
export const publish = async (title: string) => Posts.create({ title, tags: [] });

// change: updatedAt grows, and on someone else's edit $save throws VersionError
export const rename = async (id: Post["_id"], title: string) => {
  const post = await Posts.findById(id).orFail();
  post.title = title;
  await post.$save();
  return post.updatedAt;
};
