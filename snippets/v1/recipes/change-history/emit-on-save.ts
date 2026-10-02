import { Entity, Post, Prop, Schema } from "@venloc/typemo";
declare const __publish__: (event: { type: string; title: string }) => void;
// ---cut---
@Schema({ collection: "accounts", audit: true })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Post("document.save")
  announce(this: Account): void {
    __publish__({ type: "account.saved", title: this.title });
  }
}
