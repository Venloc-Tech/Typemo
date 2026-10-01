/*
 * `Types` of `@venloc/typemo` (like `mongoose.Types`): the BSON classes users need to build values —
 * `Types.ObjectId`, `Types.UUID`, `Types.Decimal128`, … — both as values and as types
 * (`let id: Types.ObjectId`). The index re-exports this module as a namespace object
 * (`export * as Types`), an ES module namespace, not a TypeScript `namespace`.
 *
 * Re-exported from "mongodb", not "bson": the driver (CommonJS) returns instances of bson's CommonJS
 * build, while `import "bson"` resolves to its ESM build — two class sets (dual-package hazard).
 * One source of classes: a value built with `Types.ObjectId` and a value read from the database are
 * instances of the same class, so `instanceof` agrees.
 *
 * Only the types of the value table (`BsonTypeTable`): no `Code` / `BSONSymbol` / `DBRef` (legacy)
 * and no `BSONRegExp` (`bsonRegExp: false`, a native `RegExp` is the hydrated form).
 */
export { Binary, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from "mongodb";
