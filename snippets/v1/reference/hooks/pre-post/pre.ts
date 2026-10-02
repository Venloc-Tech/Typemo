import { Entity, Pre, Prop, Schema } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Pre("document.save")
  normalizeTitle(this: Account): void {
    this.title = this.title.trim();
  }
}
