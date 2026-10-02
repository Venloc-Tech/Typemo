import { Decimal128, UUID } from "mongodb";
import { Entity, Prop, Schema, TypemoClient, Types } from "@venloc/typemo";
@Schema({ collection: "readings" })
class Reading extends Entity {
  @Prop(() => String, { required: true }) label!: string;
  @Prop(() => BigInt) total?: bigint;
  @Prop(() => Types.Decimal128) weight?: Decimal128;
  @Prop(() => Types.UUID) device?: UUID;
  @Prop(() => Date) at?: Date;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/sensors");
const Readings = client.connection.model(Reading);
// ---cut---
const doc = await Readings.findOne({ label: "r1" }).orFail();
const inDocument = doc.total;
//    ^?
const forClient = doc.$toPlain().total;
//    ^?
const device = doc.$toPlain().device;
//    ^?
