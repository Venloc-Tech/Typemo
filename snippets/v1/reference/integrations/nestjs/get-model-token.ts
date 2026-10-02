import { Entity, Prop, Schema } from "@venloc/typemo";
import { getModelToken } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
const token = getModelToken(Account, { db: "archive" });
//    ^?
console.log(token.description);
// → TypemoModel:Account#1 (client "default", db "archive")
