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
const isStatus = (value: string): value is "open" | "frozen" => value === "open" || value === "frozen";

export const listAccounts = (query: {
  owner?: string | undefined;
  status?: string | undefined;
  limit?: string | undefined;
  after?: string | undefined;
}) =>
  guard(async () => {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new __BadRequest__("limit must be an integer from 1 to 100");
    }
    const status = query.status;
    if (status !== undefined && !isStatus(status)) throw new __BadRequest__("status must be open or frozen");
    const filter = {
      ...(query.owner !== undefined && { owner: query.owner }),
      ...(status !== undefined && { status }),
    };
    const page = await Accounts.keysetPage({ filter, sort: [["createdAt", "desc"]], limit, after: query.after ?? null });
    return { items: page.items.map((account) => account.$toPlain()), next: page.nextCursor };
  });
