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
    sin: fn.sin(f.ratio),
    cos: fn.cos(f.ratio),
    tan: fn.tan(f.ratio),
    asin: fn.asin(f.ratio),
    acos: fn.acos(f.ratio),
    atan: fn.atan(f.ratio),
    atan2: fn.atan2(1, 1),
    sinh: fn.sinh(f.ratio),
    cosh: fn.cosh(f.ratio),
    tanh: fn.tanh(f.ratio),
    asinh: fn.asinh(f.ratio),
    acosh: fn.acosh(2),
    atanh: fn.atanh(f.ratio),
    degreesToRadians: fn.degreesToRadians(180),
    radiansToDegrees: fn.radiansToDegrees(1),
    sigmoid: fn.sigmoid(0),
    _id: 0,
  })),
);
console.log(row);
// → {sin: 0.479425538604203, cos: 0.8775825618903728, tan: 0.5463024898437905, asin: 0.5235987755982988, acos: 1.0471975511965976, atan: 0.46364760900080615, atan2: 0.7853981633974483, sinh: 0.5210953054937474, cosh: 1.1276259652063807, tanh: 0.46211715726000974, asinh: 0.48121182505960347, acosh: 1.3169578969248166, atanh: 0.5493061443340549, degreesToRadians: 3.141592653589793, radiansToDegrees: 57.29577951308232, sigmoid: 0.5}
