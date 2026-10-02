import { type AnyPopulationDoc, Entity, isPopulated, Prop, Schema, Timestamped, TypemoClient, Types, type Ref } from "@venloc/typemo";
@Schema({ collection: "employees" })
class Employee extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "accounts" })
class Account extends Timestamped(Entity) {
  @Prop(() => String, { required: true, unique: true, minLength: 2 }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Types.ObjectId, { ref: () => Employee }) manager?: Ref<Employee>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.db().model(Account);
class __NotFound__ extends Error {}
const guard = async <R>(work: () => Promise<R>): Promise<R> => work();
// ---cut---
const toResponse = (account: AnyPopulationDoc<Account>) => ({
  id: String(account._id),
  title: account.title,
  manager: isPopulated(account, "manager") ? (account.manager?.name ?? null) : undefined,
});

export const getAccountView = (id: string, expand?: "manager") =>
  guard(async () => {
    if (expand === "manager") return toResponse(await Accounts.findById(id).populate("manager").orFail());
    return toResponse(await Accounts.findById(id).orFail());
  });
