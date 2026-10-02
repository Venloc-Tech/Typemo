import { PolicyContext } from "@venloc/typemo";
// ---cut---
const merged = PolicyContext.merge({ tenant: "a", actor: "u" }, { allTenants: true }, "myWrapper");
console.log(merged);
// → { actor: "u", allTenants: true }
