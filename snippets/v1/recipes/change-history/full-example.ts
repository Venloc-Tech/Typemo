import { ObjectId } from "mongodb";
import {
  type AuditEntry,
  type Defaulted,
  Entity,
  PolicyContext,
  Post,
  Prop,
  Schema,
  TypemoClient,
} from "@venloc/typemo";

// your code: sends an event to the rest of the application
declare const __publish__: (event: { type: string; title: string }) => void;

// accounts/account.ts
@Schema({ collection: "accounts", audit: true })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { min: 0, default: 0 })
  balance!: Defaulted<number>;

  @Prop(() => String, { sensitive: "mask" })
  card?: string;

  @Post("document.save")
  announce(this: Account): void {
    __publish__({ type: "account.saved", title: this.title });
  }
}

export const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.db().model(Account);

// http/as-actor.ts: the actor of every write of a request
export const asActor = <R>(userId: string, work: () => R): R => PolicyContext.run({ actor: userId }, work);

// writes
export const openAccount = (userId: string, title: string, card: string) =>
  asActor(userId, () => Accounts.create({ title, card }));

export const deposit = (userId: string, id: string, amount: number) =>
  asActor(userId, () => Accounts.updateOne({ _id: id }, { $inc: { balance: amount } }).orFail());

// history of one account, oldest first
export const historyOf = async (id: string) => {
  const trail = client.unsafeDriver().db("bank").collection<AuditEntry>("accounts_audit");
  const oid = new ObjectId(id);
  const entries = await trail
    .find({ $or: [{ "filter._id": oid }, { "filter._id.$in": oid }, { "documents._id": oid }] })
    .sort({ _id: 1 })
    .toArray();
  return entries.map(describeEntry);
};

// one line of the history for a person
export const describeEntry = (entry: AuditEntry): { at: Date; actor: unknown; what: string } => {
  const what = (() => {
    if (entry.operation === "insertOne") return "created";
    if (entry.operation === "deleteOne" || entry.operation === "deleteMany") return "deleted";
    const update = entry.update;
    if (update === undefined || Array.isArray(update)) return entry.operation;
    return Object.entries(update)
      .flatMap(([operator, fields]) =>
        typeof fields === "object" && fields !== null ? Object.keys(fields).map((field) => `${operator} ${field}`) : [],
      )
      .join(", ");
  })();
  return { at: entry.at, actor: entry.actor, what };
};
