import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Index({ email: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "email_active" }) // [!code highlight]
@Schema()
class Account extends Entity {
  @Prop(() => String) email?: string;
  @Prop(() => Boolean) active?: boolean;
}
const Accounts = client.db().model(Account);
console.log(Accounts.schema.describe().indexes);
// → [{ keys: { email: 1 }, options: { unique: true, partialFilterExpression: { active: true }, name: "email_active" } }]
