import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;
}

await using client = await TypemoClient.connect("mongodb://localhost:27017/app");

// server: a command past the models, through the driver
const info = await client.unsafeDriver().db("admin").command({ buildInfo: 1 });
console.log("MongoDB", String(info.version));

// data: only through a model, so the policies apply
const total = await client.connection.model(Account).countDocuments();
console.log("accounts:", total);
