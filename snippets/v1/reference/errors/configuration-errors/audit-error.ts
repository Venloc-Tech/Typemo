import { AuditError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "payments", audit: true })
class Payment extends Entity {
  @Prop(() => Number, { required: true })
  amount!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Payments = client.connection.model(Payment);
// ---cut---
await client.unsafeDriver().db("app").createCollection("payments_audit", {
  validator: { $jsonSchema: { bsonType: "object", required: ["nope"] } },
});

try {
  await Payments.create({ amount: 2 });
} catch (error) {
  if (error instanceof AuditError) {
    console.log(error.message);
    // → Payment.create: the audit entry could not be written; the transaction is aborted with this error, the write is rolled back
    console.log(error.model, error.operation, error.applied);
    // → "Payment" "create" false
    console.log((error.cause as { code?: number }).code);
    // → 121
  }
}
