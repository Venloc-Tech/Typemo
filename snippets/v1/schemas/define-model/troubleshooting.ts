import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true })
  login!: string;

  nick?: string; // forgot @Prop
}
try {
  client.connection.model(User);
} catch (error) {
  console.log((error as Error).message);
}
// → User: property "nick" has no @Prop, so it is not a field of the schema (never stored, cast or loaded); decorate it with @Prop, declare it with "declare", or make it a getter or a method
