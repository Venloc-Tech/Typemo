import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "checked", validator: { validationLevel: "moderate", validationAction: "warn" } }) // [!code highlight]
class Checked extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const Items = client.db().model(Checked);
await client.db().init();
const [info] = await client.unsafeDriver().db("app").listCollections({ name: "checked" }, { nameOnly: false }).toArray();
console.log(info?.options);
// → { validator: { $jsonSchema: { bsonType: "object", properties: { _id: { bsonType: "objectId" }, name: { bsonType: "string" } }, required: ["_id", "name"], additionalProperties: false } }, validationLevel: "moderate", validationAction: "warn" }
