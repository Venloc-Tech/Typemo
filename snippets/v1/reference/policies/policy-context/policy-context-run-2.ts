import { PolicyContext } from "@venloc/typemo";
// ---cut---
const inner = PolicyContext.run({ tenant: "a", actor: "user-1" }, () =>
  PolicyContext.run({ tenant: "b" }, () => PolicyContext.current()),
);
console.log(inner);
// → { tenant: "b", actor: "user-1" }

const all = PolicyContext.run({ tenant: "a" }, () =>
  PolicyContext.run({ allTenants: true }, () => PolicyContext.current()),
);
console.log(all);
// → { allTenants: true }
