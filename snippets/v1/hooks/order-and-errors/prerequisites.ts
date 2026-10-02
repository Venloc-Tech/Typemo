import { Entity, Post, PostError, Pre, Prop, Schema } from "@venloc/typemo";

export const log: string[] = [];

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Pre("document.save")
  async first(this: Account): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    log.push("pre 1 (async)");
  }

  @Pre("document.save")
  second(this: Account): void {
    log.push("pre 2");
  }

  @Pre("document.save")
  third(this: Account): void {
    log.push("pre 3");
  }

  @Post("document.save")
  after(this: Account): void {
    log.push("post");
  }

  @PostError("document.save")
  failed(this: Account, error: unknown): void {
    log.push(`postError ${error instanceof Error ? error.message : String(error)}`);
  }
}
