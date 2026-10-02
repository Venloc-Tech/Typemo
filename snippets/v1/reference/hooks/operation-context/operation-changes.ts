import type { ChangeKeys } from "@venloc/typemo";
// ---cut---
type Find = ChangeKeys<"query.find">;
//   ^?
type Update = ChangeKeys<"query.updateOne">;
//   ^?
type Insert = ChangeKeys<"model.insertMany">;
//   ^?
