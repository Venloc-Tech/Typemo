import { Binary, Decimal128, UUID } from "mongodb";
import { Entity, Prop, Schema, Spec, TypemoClient, Types, type Vector } from "@venloc/typemo";
@Schema({ collection: "readings" })
class Reading extends Entity {
  @Prop(() => String, { required: true }) label!: string;
  @Prop(() => Types.Double) ratio?: number;
  @Prop(() => Types.Int32) count?: number;
  @Prop(() => BigInt) total?: bigint;
  @Prop(() => Types.Decimal128) price?: Decimal128;
  @Prop(() => Boolean) ok?: boolean;
  @Prop(() => Date) at?: Date;
  @Prop(() => Spec.binary({ subtype: 0 })) blob?: Binary;
  @Prop(() => Types.UUID) uid?: UUID;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) vec?: Vector;
  @Prop(() => RegExp) re?: RegExp;
  @Prop(() => Types.Timestamp) ts?: InstanceType<typeof Types.Timestamp>;
  @Prop(() => Spec.map(BigInt)) scores?: Map<string, bigint>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "sensors" });
const Readings = client.db().model(Reading);
// ---cut---
const doc = await Readings.findOne({ label: "r1" }).orFail();
const lean = await Readings.findOne({ label: "r1" }).orFail().lean();
const plain = doc.$toPlain();
const json = doc.$toJSON();
console.log(typeof lean.total, typeof plain.total, typeof json.total);
// → "bigint" "string" "string"
