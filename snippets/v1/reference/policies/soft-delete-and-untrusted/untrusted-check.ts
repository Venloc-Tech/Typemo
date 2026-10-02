import { Untrusted } from "@venloc/typemo";
// ---cut---
Untrusted.check({ d: new Date() });
// → fine: a date is data, we do not look inside

try {
  Untrusted.check(new Map([["$x", 1]]));
} catch (error) {
  console.log((error as Error).message);
  // → untrusted value: "$x" at "$x" — an operator inside data from outside (query selector injection); validate the input and build the filter yourself [sanitize]
}
