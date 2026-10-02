import { Contract, Entity, type Hidden, Prop, Schema, type Selected, type SelectedJson, type SelectedLean, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
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
      if (typeof row.name !== "string" || row.name.length < 4) {
        return { issues: [{ message: "name is too short", path: ["name"] }] };
      }
      return { value: { name: row.name.toUpperCase() } };
    },
    types: undefined as unknown as { input: unknown; output: { name: string } },
  },
};

const rows = await Users.find({ name: "Alice" }).plain().parse(nameRow);
//    ^?
console.log(rows);
// → [{ name: "ALICE" }]
