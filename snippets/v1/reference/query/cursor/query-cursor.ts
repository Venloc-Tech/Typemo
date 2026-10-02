import { type CursorSource, type QueryCursor, TypedCursor } from "@venloc/typemo";
// ---cut---
const source: CursorSource<number> = {
  async *[Symbol.asyncIterator]() {
    yield 1;
    yield 2;
    yield 3;
  },
  close: async () => {},
};

const cursor: QueryCursor<number> = new TypedCursor(source);
const doubled = await cursor.map((n) => n * 2).toArray();
console.log(doubled);
// → [2, 4, 6]
