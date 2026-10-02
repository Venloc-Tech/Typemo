import { Entity, Post, PostError, Pre, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Pre("document.save")
  normalizeTitle(this: Account): void {
    this.title = this.title.trim();
  }

  @Post("document.save")
  logSaved(this: Account): void {
    console.log(`сохранён счёт ${this.title}`);
  }

  @PostError("document.save")
  logFailed(this: Account, error: unknown): void {
    console.error(`счёт ${this.title} не сохранён:`, error);
  }
}
