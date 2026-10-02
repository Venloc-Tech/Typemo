import { Timestamp } from "mongodb";
import { Entity, fn, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class Line {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => Number, { required: true }) quantity!: number;
  @Prop(() => Number, { required: true }) delta!: number;
  @Prop(() => Number, { required: true }) ratio!: number;
  @Prop(() => Number) discount?: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
  @Prop(() => Date, { required: true }) shippedAt!: Date;
  @Prop(() => Timestamp) stamp?: Timestamp;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Number]) prices!: number[];
  @Prop(() => [Line]) lines!: Line[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const [row] = await Orders.aggregate((p) =>
  p.project((f) => ({
    concatArrays: fn.concatArrays(f.tags, ["x"]),
    setUnion: fn.setUnion(f.tags, ["sale", "big"]),
    setIntersection: fn.setIntersection(f.tags, ["sale", "x"]),
    setDifference: fn.setDifference(f.tags, ["sale"]),
    setIsSubset: fn.setIsSubset(["sale"], f.tags),
    setEquals: fn.setEquals(f.tags, ["pen", "sale", "new"]),
    zip: fn.zip({ inputs: [f.tags, f.prices] }),
    _id: 0,
  })),
);
console.log(row);
// → {concatArrays: ["new", "sale", "pen", "x"], setUnion: ["big", "new", "pen", "sale"], setIntersection: ["sale"], setDifference: ["new", "pen"], setIsSubset: true, setEquals: true, zip: [["new", 30], ["sale", 10], ["pen", 20]]}
