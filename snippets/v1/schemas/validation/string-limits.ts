import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, match: /^[a-z0-9_]+$/ }) // [!code highlight]
  login!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) // [!code highlight]
  role!: Defaulted<"user" | "admin">;
}
const Users = client.connection.model(User);
try {
  await Users.create({ login: "a b c", role: "root" as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "login": must match /^[a-z0-9_]+$/ [match]; "role": must be one of "user", "admin" [enum]
