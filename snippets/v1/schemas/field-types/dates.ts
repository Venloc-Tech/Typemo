import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => Date, { required: true }) opened!: Date;
}
const Accounts = client.connection.model(Account);
// ---cut---
const account = await Accounts.create({ opened: "2024-01-02T03:04:05Z" as never });
console.log(account.opened.toISOString());
// → 2024-01-02T03:04:05.000Z
try {
  await Accounts.create({ opened: "yesterday" as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Date failed at path "opened" for "yesterday" (string): not an ISO 8601 date (YYYY-MM-DD) or a full date-time with a zone (YYYY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm)) [format]
