import { ObjectId, UUID } from "mongodb";
import { BsonTypeTable } from "@venloc/typemo";

console.log(BsonTypeTable.kindOf(4), BsonTypeTable.kindOf(4.5), BsonTypeTable.kindOf(4n), BsonTypeTable.kindOf(new UUID()));
// → "int32" "double" "long" "uuid"

const plain = BsonTypeTable.toPlain({ id: new ObjectId("6abd0031bc77f4bc3599f62f"), big: 5n, nested: [1] });
console.log(plain);
// → { id: "6abd0031bc77f4bc3599f62f", big: "5", nested: [1] }

const json = BsonTypeTable.toJson({ big: 5n, re: /a/i, tags: new Map([["a", 1n]]) });
console.log(json);
// → { big: "5", re: "/a/i", tags: { a: "1" } }
