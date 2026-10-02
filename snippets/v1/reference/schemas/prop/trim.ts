import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Signup extends Entity {
  @Prop(() => String, { trim: true }) // [!code highlight]
  login?: string;
}
const Signups = client.db().model(Signup);
const signup = await Signups.create({ login: "  alice  " });
console.log(signup.login);
// → alice
