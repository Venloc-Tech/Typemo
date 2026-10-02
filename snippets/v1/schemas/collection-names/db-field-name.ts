import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "legacy_clients" })
class Client extends Entity {
  @Prop(() => String, { dbName: "e" }) // [!code highlight]
  email?: string;
}

const Clients = client.db().model(Client);
await Clients.create({ email: "a@b.c" });
// in the database: { e: "a@b.c" }
const row = await Clients.find({ email: "a@b.c" }).plain();
// → [{ _id: "…", email: "a@b.c" }]
console.log(Clients.schema.toDbPath("email"));
// → e
