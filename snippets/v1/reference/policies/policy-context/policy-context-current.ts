import { PolicyContext } from "@venloc/typemo";
// ---cut---
console.log(PolicyContext.current());
// → undefined

const inside = PolicyContext.run({ tenant: "a", actor: "u1" }, () => PolicyContext.current());
console.log(inside);
// → { tenant: "a", actor: "u1" }
