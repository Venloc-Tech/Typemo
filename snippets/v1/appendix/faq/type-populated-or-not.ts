import { type AnyPopulationDoc, Entity, isPopulated, Prop, type Ref, Schema, Types } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}
// ---cut---
const authorName = (post: AnyPopulationDoc<Post>): string | undefined =>
  isPopulated(post, "author") ? post.author?.name : undefined;
