import { Keyset } from "@venloc/typemo";
// ---cut---
const condition = Keyset.afterFilter([["views", -1], ["_id", -1]], [40, "ID"]);
console.log(condition);
// → { $or: [{ views: { $lt: 40 } }, { views: 40, _id: { $lt: "ID" } }] }
