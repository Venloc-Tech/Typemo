import { Entity, type HookThis, Post, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class Line {
  @Prop(() => String, { required: true }) note!: string;

  @Pre("document.save")
  preSave(this: HookThis<"document.save", Line>): void {
    console.log(`  entry ${this.note}: pre, new: ${this.$isNew()}, root: ${this.$isRoot()}`);
  }
  @Post("document.save")
  postSave(this: Line): void {
    console.log(`  entry ${this.note}: post`);
  }
}

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [Line]) lines!: Line[];

  @Pre("document.save")
  preSave(this: Account): void {
    console.log("account: pre");
  }
  @Post("document.save")
  postSave(this: Account): void {
    console.log("account: post");
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.create({ title: "Main", lines: [{ note: "a" }, { note: "b" }] });
// → account: pre
// →   entry a: pre, new: true, root: false
// →   entry b: pre, new: true, root: false
// →   entry a: post
// →   entry b: post
// → account: post
