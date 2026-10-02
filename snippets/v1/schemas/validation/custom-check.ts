import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
const taken = new Set(["root"]); // your code: taken logins

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) login!: string;

  @Prop(() => String, {
    validate: [
      (value) => value.includes("@") || "must contain @", // [!code highlight]
      (value) => value.endsWith(".com") || "must end with .com", // [!code highlight]
    ],
  })
  email?: string;

  @Prop(() => String, {
    validate: async (value, context) => { // [!code highlight]
      await Promise.resolve();
      return !taken.has(value) || `"${value}" is taken (${context.kind}:${context.operation})`;
    },
  })
  handle?: string;
}
const Users = client.connection.model(User);
try {
  await Users.create({ login: "abc", email: "nope", handle: "root" });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "email": must contain @ [validator]; "email": must end with .com [validator]; "handle": "root" is taken (document:save) [validator]
