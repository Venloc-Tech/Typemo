import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "settings" })
class Setting extends Entity {
  @Prop(() => Spec.union(String, Number)) // [!code highlight]
  value?: string | number;
}
const Settings = client.connection.model(Setting);
try {
  await Settings.create({ value: true as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string | number failed at path "value" for true (boolean): no member accepts this value (members: string, number) [union-no-match]
