import { ValidationError } from "@venloc/typemo";
declare const error: ValidationError;
// ---cut---
const payload = error.toJSON();
// → { name: "ValidationError", message: "Validation failed: …", issues: [{ path: "owner", reason: "required", message: "the field is required" }, …] }
