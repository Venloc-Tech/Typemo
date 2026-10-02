import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Account extends Entity {
  @Prop(() => String, { unique: true, sparse: true }) // [!code highlight]
  nickname?: string;
}
const Accounts = client.db().model(Account);
console.log(Accounts.schema.describe().indexes);
// → [{ keys: { nickname: 1 }, options: { unique: true, sparse: true } }]
