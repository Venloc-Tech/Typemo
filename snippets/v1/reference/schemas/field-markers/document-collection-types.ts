import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Line {
  @Prop(() => String) sku?: string;
}
@Schema()
class Order extends Entity {
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Spec.map(Number)) scores?: Map<string, number>;
}
const Orders = client.db().model(Order);
const order = await Orders.findOne({}).orFail();
const tags = order.tags;
//    ^?
const lines = order.lines;
//    ^?
