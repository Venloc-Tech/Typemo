import { PolicyContext } from "@venloc/typemo";
// ---cut---
console.log(PolicyContext.EMPTY, Object.isFrozen(PolicyContext.EMPTY));
// → {} true
