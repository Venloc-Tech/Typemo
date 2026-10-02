import { CastError, DocumentNotFoundError, DuplicateKeyError, Entity, KeysetTokenError, Prop, QueryError, Schema, StrictModeError, Timestamped, TypemoClient, ValidationError, type Defaulted } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Timestamped(Entity) {
  @Prop(() => String, { required: true, unique: true, minLength: 2 }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { enum: ["open", "frozen"], default: "open" }) status!: Defaulted<"open" | "frozen">;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.db().model(Account);
class __NotFound__ extends Error {}
class __BadRequest__ extends Error {
  constructor(message: string, readonly issues?: unknown) { super(message); }
}
class __Conflict__ extends Error {}
const guard = async <R>(work: () => Promise<R>): Promise<R> => work();
// ---cut---
export const updateAccount = (id: string, body: { title?: string | undefined; status?: "open" | "frozen" | undefined }) =>
  guard(async () => {
    const account = await Accounts.findById(id).orFail();
    if (body.title !== undefined) account.$set("title", body.title);
    if (body.status !== undefined) account.$set("status", body.status);
    await account.$save();
    return account.$toPlain();
  });
