import { Entity } from "@venloc/typemo";
import { Index, Pre, Prop, Schema } from "@venloc/typemo-decorators";

@Schema({ collection: "accounts" })
@Index({ title: 1, balance: -1 }, { unique: true })
export class Account extends Entity {
  @Prop(() => String, { required: true, trim: true })
  title!: string;

  @Prop(() => Number, { min: 0 })
  balance!: number;

  @Pre("document.save")
  touch(this: Account): void {
    this.title = `${this.title}!`;
  }
}
