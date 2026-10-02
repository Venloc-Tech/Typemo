import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Account extends Entity {
  @Prop(() => String, { immutable: true })
  country?: Immutable<string>;
}
const Accounts = client.db().model(Account);
try {
  await Accounts.updateOne({ country: "PL" }, { $set: { country: "DE" } } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → $set.country: "country" is immutable; it is written only when the document is created ($setOnInsert on upsert) [immutable]
