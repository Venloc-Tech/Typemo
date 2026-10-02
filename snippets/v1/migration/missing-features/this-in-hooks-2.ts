import { type Defaulted, Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Boolean, { default: false }) archived!: Defaulted<boolean>;

  @Pre("query.find")
  onlyActive(this: OperationHookContext<Post, "query.find">): void {
    this.modify({ where: { archived: false } });
  }
}
