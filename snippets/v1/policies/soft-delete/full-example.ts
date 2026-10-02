import { Entity, Prop, Schema, TypemoClient, SoftDelete } from "@venloc/typemo";

@Schema({ collection: "posts", softDelete: true })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Posts = client.connection.model(Post);

// delete: a mark
export const removePost = (title: string) => Posts.deleteOne({ title });

// trash: only deleted ones
export const listTrash = () => Posts.find().policy({ onlyDeleted: true }).plain();

// undo the delete
export const restorePost = (title: string) => SoftDelete.restore(Posts, { title });

// empty the trash: for good
export const emptyTrash = (title: string) => SoftDelete.purge(Posts, { title });
