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
const createAccount = async (body: { title: string; owner: string }) => ({ ...body });
// ---cut---
await createAccount({ title: "x", owner: "alice" }).catch((error) => console.log(error.message, error.issues));
// → validation failed [{ path: "title", reason: "minLength", message: "must be at least 2 characters long" }]

await createAccount({ title: "Main", owner: "bob" }).catch((error) => console.log(error.message));
// → title is taken

await createAccount({ title: "Zed", owner: "bob", role: "admin" } as never).catch((error) => console.log(error.message));
// → Cast to Account failed at path "role" for "admin" (string): not a field of Account [unknown-key]
