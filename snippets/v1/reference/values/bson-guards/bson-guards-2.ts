import { BsonGuards } from "@venloc/typemo";

class Foo {
  a = 1;
}

console.log(BsonGuards.isPlainObject({ a: 1 }), BsonGuards.isPojo({ a: 1 }));
// → true true
console.log(BsonGuards.isPlainObject(new Foo()), BsonGuards.isPojo(new Foo()));
// → true false
console.log(BsonGuards.isPlainObject(new Map()), BsonGuards.isOpaqueValue(new Map()));
// → false true
