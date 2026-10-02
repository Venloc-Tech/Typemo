import { ConfigurationError, TypemoError } from "@venloc/typemo";
// ---cut---
const error = new ConfigurationError("bad option", { cause: new Error("original") });

console.log(error instanceof TypemoError);
// → true
console.log(String(error));
// → "ConfigurationError: bad option"
console.log(error.cause instanceof Error);
// → true
