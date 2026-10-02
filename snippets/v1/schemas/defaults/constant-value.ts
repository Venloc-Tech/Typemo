import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { default: 0 }) // [!code highlight]
  score!: Defaulted<number>;
  @Prop(() => String, { nullable: true, default: null }) // [!code highlight]
  note!: Defaulted<string | null>;
}
const Members = client.connection.model(Member);
const member = await Members.create({ name: "Ann" });
console.log(member.score, member.note);
// → 0 null
