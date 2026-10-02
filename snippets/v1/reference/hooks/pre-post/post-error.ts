import { Entity, PostError, Prop, Schema } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @PostError("document.save")
  reportFailure(this: Account, error: unknown): void {
    console.error(`failed to save ${this.title}:`, error instanceof Error ? error.message : error);
  }
}
