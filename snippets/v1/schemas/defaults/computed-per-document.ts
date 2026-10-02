import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Date, { default: () => new Date() }) // [!code highlight]
  joined!: Defaulted<Date>;
  @Prop(() => [String], { default: () => ["new"] }) // [!code highlight]
  tags!: string[];
}
const Members = client.connection.model(Member);
const first = await Members.create({ name: "Ann" });
const second = await Members.create({ name: "Bob" });
first.tags.push("vip");
console.log(first.tags.length, second.tags.length);
// → 2 1
console.log(first.joined.getTime() === second.joined.getTime());
// → false
