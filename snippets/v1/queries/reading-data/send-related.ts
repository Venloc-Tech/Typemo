// @filename: customer.ts
import { Entity, Prop, Schema } from "@venloc/typemo";
@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
// @filename: account.ts
// ---cut---
import { Entity, Prop, type Ref, Schema, Types } from "@venloc/typemo";
import { Customer } from "./customer";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => BigInt, { required: true })
  balance!: bigint;

  @Prop(() => Types.ObjectId, { ref: () => Customer, required: true }) // [!code ++]
  owner!: Ref<Customer>; // [!code ++]
}
