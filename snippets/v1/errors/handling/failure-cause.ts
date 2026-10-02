import { TypemoError } from "@venloc/typemo";
declare const error: TypemoError;
declare const __logger__: { warn(message: string, fields: unknown): void };
// ---cut---
__logger__.warn(error.message, { name: error.name, cause: error.cause });
