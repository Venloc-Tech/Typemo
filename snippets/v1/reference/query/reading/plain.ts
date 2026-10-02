import { Entity, Prop, Schema, Spec, Types, TypemoClient } from "@venloc/typemo";
import type { Decimal128 } from "mongodb";
@Schema({ collection: "wallets" })
class Wallet extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => BigInt) points?: bigint;
  @Prop(() => Types.Decimal128) balance?: Decimal128;
  @Prop(() => Date) opened?: Date;
  @Prop(() => Spec.map(Number)) limits?: Map<string, number>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Wallets = client.db().model(Wallet);
// ---cut---
const wallet = await Wallets.findOne({ owner: "w1" }).plain().orFail();
//    ^?
// → { _id: "6abcde37…", owner: "w1", points: "9007199254740993", balance: "10.50",
//     opened: 2026-01-02T00:00:00.000Z, limits: Map(1) { "daily" => 100 } }
