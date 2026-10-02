import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

// the collection and the field are named explicitly: the data predates Typemo
@Schema({ collection: "legacy_clients" })
class Client extends Entity {
  @Prop(() => String, { dbName: "e", required: true })
  email!: string;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Clients = client.db().model(Client);

// the code uses email, the database stores e
export const findByEmail = async (email: string) => Clients.findOne({ email }).plain();
