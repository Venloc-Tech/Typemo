import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Account extends Entity {}

@Schema({ collection: "legacy_clients" }) // [!code highlight]
class Client extends Entity {}

console.log(client.db().model(Account).collectionName, client.db().model(Client).collectionName);
// → accounts legacy_clients
