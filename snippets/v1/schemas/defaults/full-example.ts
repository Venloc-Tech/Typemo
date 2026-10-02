import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// model: a constant value, a function and an array (empty by itself)
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) role!: Defaulted<"user" | "admin">;
  @Prop(() => Number, { default: 0 }) score!: Defaulted<number>;
  @Prop(() => Date, { default: () => new Date() }) joined!: Defaulted<Date>;
  @Prop(() => [String]) tags!: string[];
}

// sign-up: pass only the name
export const join = async (name: string) => {
  const Members = client.connection.model(Member);
  const member = await Members.create({ name });
  return member.$toPlain();
};

const dto = await join("Ann");
console.log(dto.role, dto.score, dto.tags, dto.joined instanceof Date);
// → user 0 [] true
