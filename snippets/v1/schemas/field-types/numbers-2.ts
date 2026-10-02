import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "shelves" })
class Shelf extends Entity {
  @Prop(() => Types.Int32) // [!code highlight]
  slots?: number;
}
const Shelves = client.connection.model(Shelf);
try {
  await Shelves.create({ slots: 1.5 });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Int32 failed at path "slots" for 1.5 (number): a fractional number is not an Int32 [integer]
