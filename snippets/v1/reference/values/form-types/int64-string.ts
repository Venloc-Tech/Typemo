import { Binary, Decimal128, UUID } from "mongodb";
import { Entity, Prop, Schema, Spec, TypemoClient, Types, type Hidden, type Vector } from "@venloc/typemo";
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
  @Prop(() => String, { hidden: true }) secret?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "sensors" });
const Readings = client.db().model(Reading);
// ---cut---
const doc = await Readings.findOne({ label: "r1" }).orFail();
const total = doc.$toPlain().total;
if (total !== undefined) await Readings.updateOne({ label: "r1" }, { $set: { total } });
