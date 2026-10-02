import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "contacts" })
class Contact extends Entity {
  @Prop(() => String, { required: true, nullable: true }) // [!code highlight]
  phone!: string | null;
}
const Contacts = client.connection.model(Contact);
const contact = await Contacts.create({ phone: null });
const phone = contact.phone;
//    ^?
console.log(phone);
// → null
try {
  await Contacts.create({} as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "phone": the field is required [required]
try {
  await Contacts.updateOne({ phone: null }, { $unset: { phone: 1 } } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "phone": the field is required; $unset would remove it [required]
