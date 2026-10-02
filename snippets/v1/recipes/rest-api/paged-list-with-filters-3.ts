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
const listAccounts = async (query: { owner?: string | undefined; limit?: string | undefined; after?: string | undefined }) => ({ items: [] as { title: string }[], next: null as string | null });
// ---cut---
const first = await listAccounts({ owner: "alice", limit: "1" });
console.log(first.items.map((item) => item.title));
// → ["Second"]

const second = await listAccounts({ owner: "alice", limit: "1", after: first.next ?? undefined });
console.log(second.items.map((item) => item.title), second.next);
// → ["Main"] null
