import { ConfigurationError } from "@venloc/typemo";
// ---cut---
console.log(Object.keys(new ConfigurationError("x")));
// → []
