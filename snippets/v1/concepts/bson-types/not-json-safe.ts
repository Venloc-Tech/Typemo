import { Binary, Decimal128, Long, ObjectId } from "mongodb";
// ---cut---
console.log(JSON.stringify({ id: new ObjectId("6abcb88b25109dc2cd5d67c3") }));
// → {"id":"6abcb88b25109dc2cd5d67c3"}
console.log(JSON.stringify({ price: Decimal128.fromString("19.99") }));
// → {"price":{"$numberDecimal":"19.99"}}
console.log(JSON.stringify({ bytes: new Binary(new Uint8Array([1, 2, 3])) }));
// → {"bytes":"AQID"}
console.log(JSON.stringify({ total: Long.fromString("9007199254740993") }));
// → {"total":{"high":2097152,"low":1,"unsigned":false}}
