import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Account extends Entity {
  @Prop(() => String, { immutable: true })
  country?: Immutable<string>;
}
const Accounts = client.db().model(Account);
const account = await Accounts.create({ country: "PL" });
const country = account.country;
//    ^?
