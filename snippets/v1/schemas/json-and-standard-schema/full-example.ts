import { Entity, type Defaulted, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users", validator: true })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3 })
  name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;
}

// your code: the error at the application boundary
class __BadRequest__ extends Error {}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);

// start: the collection is created together with the server validator
await client.db().init();

// form handler: validate the input and return the problem texts
export const signUp = async (input: unknown) => {
  const result = await Users["~standard"].validate(input);
  if (result.issues !== undefined) throw new __BadRequest__(result.issues.map((issue) => issue.message).join("; "));
  return Users.create({ name: (result.value as { name: string }).name });
};
