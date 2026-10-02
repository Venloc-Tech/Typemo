import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "legacy", autoIndex: false })
class Legacy extends Entity {
  @Prop(() => String, { required: true, unique: true }) code!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Legacies = client.connection.model(Legacy);
// ---cut---
const report = await client.connection.init();
console.log(report.collections[0]?.indexes);
// → undefined
console.log((await Legacies.listIndexes()).map((index) => index.name));
// → ["_id_"]

await Legacies.syncIndexes();
console.log((await Legacies.listIndexes()).map((index) => index.name));
// → ["_id_", "code_1"]
