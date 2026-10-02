import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "boards" })
class Board extends Entity {
  @Prop(() => [[Number]]) // [!code highlight]
  cells?: number[][];
}
const Boards = client.connection.model(Board);
const board = await Boards.create({ cells: [[1, 2], [3]] });
console.log(board.$toPlain().cells);
// → [[1, 2], [3]]
try {
  await Boards.create({ cells: [[1], "x"] as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Array<number> failed at path "cells.1" for "x" (string): expected an array [type]
