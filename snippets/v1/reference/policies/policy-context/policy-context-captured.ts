import { PolicyContext } from "@venloc/typemo";
// ---cut---
console.log(PolicyContext.captured());
// → { policy: {} }

const inside = PolicyContext.run({ tenant: "z" }, () => PolicyContext.captured());
console.log(inside);
// → { policy: { tenant: "z" } }
