import { ConfigurationError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
@Schema({ collection: "orders", optimisticConcurrency: true })
class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;
}

try {
  client.connection.model(Order);
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.log(error.message);
    // → Order: optimisticConcurrency needs the version field — extend Versioned(...)
  }
}
