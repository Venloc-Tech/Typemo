import { untrusted, StrictModeError } from "@venloc/typemo";
// ---cut---
try {
  untrusted({ a: [{ b: { $gt: 1 } }] });
} catch (error) {
  if (error instanceof StrictModeError) {
    console.log(error.message);
    // → untrusted value: "$gt" at "a.0.b.$gt" — an operator inside data from outside (query selector injection); validate the input and build the filter yourself [sanitize]
    console.log(error.reason, error.path);
    // → "sanitize" "a.0.b.$gt"
  }
}
