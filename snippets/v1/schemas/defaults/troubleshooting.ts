import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => Number, { default: "x" as never }) // wrong: a string in a number field
  score!: Defaulted<number>;
}
try {
  client.connection.model(Member);
} catch (error) {
  console.log((error as Error).message);
}
// → Member.score: the "default" value is not a value of the field (got "x" (string)): expected a number [type]
