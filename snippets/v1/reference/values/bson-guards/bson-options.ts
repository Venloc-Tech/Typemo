import { BsonOptions } from "@venloc/typemo";

console.log(BsonOptions.REQUIRED);
// → { useBigInt64: true, promoteValues: true, promoteLongs: true, promoteBuffers: false, bsonRegExp: false, ignoreUndefined: false, serializeFunctions: false, raw: false, enableUtf8Validation: true }
console.log(BsonOptions.apply({ appName: "app" }));
// → { appName: "app", useBigInt64: true, promoteValues: true, … }
