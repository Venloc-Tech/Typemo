import { CollectionManager, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const db = client.unsafeDriver().db("app");
await db.createCollection("ledger", { capped: true, size: 1024, max: 100 });
const info = await CollectionManager.info(db, "ledger");
if (info === undefined) throw new Error("no such collection");
// ---cut---
const found = CollectionManager.differences("ledger", { capped: true, size: 65_536, max: 100 }, info);
console.log(found);
// → [{ option: "size", mutable: true, wanted: 65536, actual: 1024 }]
