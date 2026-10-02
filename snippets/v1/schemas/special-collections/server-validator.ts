import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "checked", validator: true }) // [!code highlight]
class Checked extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { min: 0 }) age?: number;
}

const Items = client.db().model(Checked);
await client.db().init();
const driver = client.unsafeDriver().db("app").collection("checked");
try {
  await driver.insertOne({ name: 5 });
} catch (error) {
  console.log((error as Error).message);
}
// → Document failed validation
