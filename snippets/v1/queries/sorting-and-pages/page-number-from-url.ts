import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Posts = client.db().model(Post);
// ---cut---
const MAX_PER_PAGE = 50;

export const listPostsFromQuery = (pageParam: string | undefined, perPageParam: string | undefined) => {
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number.parseInt(perPageParam ?? "20", 10) || 20));

  return Posts.find()
    .sort({ views: -1, _id: 1 })
    .skip((page - 1) * perPage)
    .limit(perPage)
    .plain();
};
