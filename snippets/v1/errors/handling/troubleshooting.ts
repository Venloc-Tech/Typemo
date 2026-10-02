import { DuplicateKeyError, ServerError } from "@venloc/typemo";
declare const error: unknown;
// ---cut---
// wrong: ServerError also catches DuplicateKeyError
if (error instanceof ServerError) console.log("server");
else if (error instanceof DuplicateKeyError) console.log("duplicate");

// right: the specific class first
if (error instanceof DuplicateKeyError) console.log("duplicate");
else if (error instanceof ServerError) console.log("server");
