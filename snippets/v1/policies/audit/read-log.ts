import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
const trail = client.unsafeDriver().db("app").collection("transfers_audit");
const entries = await trail.find({ actor: "user-7" }).sort({ _id: 1 }).toArray();
console.log(entries.map((entry) => entry.operation));
// → ["insertOne", "updateOne"]
