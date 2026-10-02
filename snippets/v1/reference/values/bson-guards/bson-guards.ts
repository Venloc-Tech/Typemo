import { ObjectId, UUID } from "mongodb";
import { BsonGuards } from "@venloc/typemo";

const describe = (value: unknown): string => {
  if (BsonGuards.isUuid(value)) return `uuid ${value.toHexString(true)}`;
  if (BsonGuards.isObjectId(value)) return `objectId ${value.toHexString()}`;
  if (BsonGuards.isDate(value)) return "date";
  return "other";
};

console.log(describe(new ObjectId("6abcfeb2f9f532dbc77418c1")), describe(new Date()), describe(1));
// → "objectId 6abcfeb2f9f532dbc77418c1" "date" "other"
console.log(describe(new UUID("0f8fad5b-d9cb-469f-a165-70867728950e")));
// → "uuid 0f8fad5b-d9cb-469f-a165-70867728950e"
