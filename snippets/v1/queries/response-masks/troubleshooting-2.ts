import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Customers = client.db().model(Customer);
// ---cut---
// @errors: 2322
await Customers.find().plain().mask({ emial: "mask" });
// compiler: Type '"mask"' is not assignable to type '"mask" & PathError<"mask: \"emial\" is not a path of the result row">'
