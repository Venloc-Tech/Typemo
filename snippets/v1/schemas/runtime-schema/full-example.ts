import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { dbName: "e", required: true }) email!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);

// schema report: field, database name, hidden or not
export const schemaReport = () =>
  Object.entries(Users.schema.describe().paths).map(([name, path]) => ({
    name,
    dbName: path.dbPath ?? name,
    hidden: path.flags?.includes("hidden") ?? false,
  }));
