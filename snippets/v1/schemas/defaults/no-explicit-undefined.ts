import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { default: 0 }) score!: Defaulted<number>;
}
const Members = client.connection.model(Member);
// ---cut---
try {
  await Members.create({ name: "Ann", score: undefined } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to number failed at path "score" for undefined: undefined is never a value; omit the field instead [undefined]
const zero = await Members.create({ name: "Bob", score: 0 });
console.log(zero.score);
// → 0
