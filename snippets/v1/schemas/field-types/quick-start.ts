import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) limit!: number;
  @Prop(() => Boolean, { required: true }) active!: boolean;
  @Prop(() => Date, { required: true }) opened!: Date;
  @Prop(() => Types.ObjectId, { required: true }) branch!: Types.ObjectId;
}
