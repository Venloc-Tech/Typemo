import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// model: one field of each common type
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Types.Decimal128, { required: true }) balance!: Types.Decimal128;
  @Prop(() => BigInt, { required: true }) operations!: bigint;
  @Prop(() => Boolean, { required: true }) active!: boolean;
  @Prop(() => Date, { required: true }) opened!: Date;
  @Prop(() => Types.ObjectId, { required: true }) branch!: Types.ObjectId;
}

// opening an account: the branch id comes as a string
export const openAccount = async (owner: string, branchId: string) => {
  const Accounts = client.connection.model(Account);
  const account = await Accounts.create({
    owner,
    balance: Types.Decimal128.fromString("0.00"),
    operations: 0n,
    active: true,
    opened: new Date("2024-05-01T00:00:00Z"),
    branch: branchId,
  });
  // to the client: money and int64 go out as strings
  return account.$toPlain();
};

const dto = await openAccount("ann", "6abcfab53690ef6b2db71493");
console.log(dto.balance, dto.operations, dto.branch);
// → 0.00 0 6abcfab53690ef6b2db71493
