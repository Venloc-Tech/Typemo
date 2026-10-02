import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ optimisticConcurrency: true }) // [!code highlight]
class Account extends Versioned(Entity) {
  @Prop(() => Number, { default: 0 })
  balance!: Defaulted<number>;
}
const Accounts = client.db().model(Account);
const created = await Accounts.create({});
const first = await Accounts.findOne({ _id: created._id }).orFail();
const second = await Accounts.findOne({ _id: created._id }).orFail();
first.balance = 10;
await first.$save();
second.balance = 20;
try {
  await second.$save();
} catch (error) {
  console.log((error as Error).message);
}
// → Account: no document at version 0 (it was changed or deleted since it was read); modified: balance
