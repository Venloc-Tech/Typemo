import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
import { ValidationError } from "@venloc/typemo";

// model: casting, bounds, enum and a custom check
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3, maxLength: 12, match: /^[a-z0-9_]+$/ })
  login!: string;
  @Prop(() => Number, { min: 18, max: 120 }) age?: number;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) role!: Defaulted<"user" | "admin">;
  @Prop(() => String, { validate: (value) => value.includes("@") || "must contain @" }) email?: string;
}

// your code: the error at the application boundary with form fields
class __BadRequest__ extends Error {
  constructor(readonly fields: string[]) {
    super("invalid form");
  }
}

// sign-up: turn validation errors into a form error
export const register = async (login: string, age: number, email: string) => {
  const Users = client.connection.model(User);
  try {
    return await Users.create({ login, age, email });
  } catch (error) {
    if (error instanceof ValidationError) throw new __BadRequest__(Object.keys(error.errors));
    throw error;
  }
}

const created = await register("  Ann ", 30, "ann@example.com");
console.log(created.login);
// → ann
try {
  await register("a", 5, "nope");
} catch (error) {
  console.log((error as __BadRequest__).fields);
}
// → ["login", "age", "email"]
