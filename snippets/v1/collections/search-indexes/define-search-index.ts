import { Entity, Prop, Schema, SearchIndex } from "@venloc/typemo";

@Schema({ collection: "articles" })
@SearchIndex({ name: "articles_text", definition: { mappings: { dynamic: true } } })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  body!: string;
}
