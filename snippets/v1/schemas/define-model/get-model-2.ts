import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
class Plain {
  login?: string;
}
try {
  client.connection.model(Plain);
} catch (error) {
  console.log((error as Error).message);
}
// → Plain: not a schema; decorate the class with @Schema()
