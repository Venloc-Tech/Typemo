import { type ChangeEvent, Entity, type Hidden, Prop, Schema } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
// ---cut---
export const describe = (event: ChangeEvent<Account>): string => {
  switch (event.operationType) {
    case "insert":
      return `new account of ${event.fullDocument.owner}`;
    case "update":
      return `changed: ${Object.keys(event.updateDescription.updatedFields).join(", ")}`;
    case "replace":
      return `replaced: ${event.fullDocument.owner}`;
    case "delete":
      return `deleted: ${String(event.documentKey._id)}`;
    default:
      return `collection event: ${event.operationType}`;
  }
};
