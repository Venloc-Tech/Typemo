import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
// @errors: 2769
@Schema()
class Account extends Entity {
  @Prop(() => String, { immutable: true }) // [!code highlight]
  country?: Immutable<string>;
}
const Accounts = client.db().model(Account);
await Accounts.updateOne({ country: "PL" }, { $set: { country: "DE" } });
