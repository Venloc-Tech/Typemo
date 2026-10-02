import { CastError, DocumentNotFoundError, Entity, type Hidden, Prop, type Ref, Schema, Spec, Types, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => BigInt, { required: true }) balance!: bigint;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Types.ObjectId, { ref: () => Customer, required: true }) owner!: Ref<Customer>;
  @Prop(() => Spec.map(String)) labels?: Map<string, string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.db().model(Account);
const Customers = client.db().model(Customer);
declare class __NotFound__ extends Error {}
declare class __BadRequest__ extends Error {}
// ---cut---
export const getAccountWithOwner = (idFromUrl: string) =>
  Accounts.findById(idFromUrl)
    .select({ title: 1, owner: 1 })
    .populate({ path: "owner", select: { name: 1, email: 1 } })
    .orFail()
    .plain();

console.log(await getAccountWithOwner("6abcfa30531a3d0a555e2f5b"));
// → {
//     _id: "…",
//     title: "Main",
//     owner: { _id: "…", name: "Alice", email: "alice@example.com" },
//   }
