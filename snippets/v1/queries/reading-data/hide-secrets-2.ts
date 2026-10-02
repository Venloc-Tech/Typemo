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
declare const __verifyPassword__: (password: string, hash: string | undefined) => Promise<boolean>;
declare class __Unauthorized__ extends Error {}

export const login = async (email: string, password: string) => {
  const customer = await Customers.findOne({ email })
    .select({ "+passwordHash": true })
    .orFail();

  if (!(await __verifyPassword__(password, customer.passwordHash))) {
    throw new __Unauthorized__("wrong password");
  }

  return customer.$toPlain();
};

console.log(await login("alice@example.com", "…"));
// → { _id: "…", name: "Alice", email: "alice@example.com" }
