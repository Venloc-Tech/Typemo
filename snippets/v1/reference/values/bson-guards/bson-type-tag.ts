import { ObjectId, UUID } from "mongodb";
import { BsonGuards, type BsonTypeTag } from "@venloc/typemo";

const tag: BsonTypeTag | undefined = BsonGuards.tagOf(new ObjectId());
console.log(tag, BsonGuards.tagOf(new UUID()), BsonGuards.tagOf({}));
// → "ObjectId" "Binary" undefined
