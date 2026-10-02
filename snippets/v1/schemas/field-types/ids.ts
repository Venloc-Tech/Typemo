import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "transfers" })
class Transfer extends Entity {
  @Prop(() => Types.ObjectId, { required: true }) from!: Types.ObjectId;
  @Prop(() => Types.UUID, { required: true }) ticket!: Types.UUID;
}
const Transfers = client.connection.model(Transfer);
const transfer = await Transfers.create({
  from: "6abcfab53690ef6b2db71493",
  ticket: "0a1b2c3d-0000-4000-8000-000000000001",
});
console.log(transfer.from.constructor.name, transfer.ticket.constructor.name);
// → ObjectId UUID
console.log(transfer.$toPlain().ticket);
// → "0a1b2c3d-0000-4000-8000-000000000001"
