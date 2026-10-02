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
const reading = await Readings.create({
  label: "r1",
  total: 9007199254740993n,
  weight: Types.Decimal128.fromString("19.99"),
  device: "0f8fad5b-d9cb-469f-a165-70867728950e", // a string is accepted for UUID
  at: new Date("2026-01-02T03:04:05Z"),
});
console.log(JSON.stringify(reading.$toPlain()));
// → {"_id":"…","label":"r1","total":"9007199254740993","weight":"19.99","device":"0f8fad5b-d9cb-469f-a165-70867728950e","at":"2026-01-02T03:04:05.000Z"}
