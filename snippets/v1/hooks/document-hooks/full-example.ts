import { Entity, Post, PostError, Pre, Prop, Schema } from "@venloc/typemo";

@Schema()
export class Line {
  @Prop(() => String, { required: true })
  note!: string;

  // A subdocument runs its hooks together with the root.
  @Post("document.save")
  logSaved(this: Line): void {
    console.log(`проводка ${this.note} сохранена`);
  }
}

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 3 })
  title!: string;

  @Prop(() => [Line])
  lines!: Line[];

  // Cast the value before validation and writing.
  @Pre("document.save")
  normalizeTitle(this: Account): void {
    this.title = this.title.trim();
  }

  // Record the success.
  @Post("document.save")
  logSaved(this: Account): void {
    console.log(`счёт ${this.title} сохранён`);
  }

  // Record the error if validation or the write failed.
  @PostError("document.save")
  logFailed(this: Account, error: unknown): void {
    console.error(`счёт ${this.title} не сохранён:`, error instanceof Error ? error.message : error);
  }
}
