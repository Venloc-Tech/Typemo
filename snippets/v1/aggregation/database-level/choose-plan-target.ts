import { Pipeline, TypemoClient } from "@venloc/typemo";

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
const archive = client.db("archive");
const plan = Pipeline.database().documents([{ n: 1 }]).plan();

const inShop = await client.aggregate(plan);
const inArchive = await archive.aggregate(plan);
console.log(inShop, inArchive);
// → [{ n: 1 }] [{ n: 1 }]
