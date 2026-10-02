import { Entity, type Defaulted, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users", validator: true })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3 })
  name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
const nameRow = {
  "~standard": {
    version: 1 as const,
    vendor: "app",
    validate: (value: unknown) => {
      const row = value as { name?: unknown };
      if (typeof row.name !== "string") return { issues: [{ message: "name must be a string", path: ["name"] }] };
      return { value: { name: row.name } };
    },
    types: undefined as unknown as { input: unknown; output: { name: string } },
  },
};

await Users.create({ name: "zed" });
const rows = await Users.find().lean().parse(nameRow);
console.log(rows);
// → [{ name: "zed" }]
