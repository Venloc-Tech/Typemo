import { untrusted, StrictModeError } from "@venloc/typemo";
// ---cut---
const patch = JSON.parse('{"$set":{"role":"admin"}}') as { name?: string };

try {
  untrusted(patch, "update");
} catch (error) {
  if (error instanceof StrictModeError) console.log(error.message);
  // → untrusted value: "$set" at "$set" — an operator inside data from outside would change what the update does (update operator injection); validate the input and build the update yourself [sanitize]
}
