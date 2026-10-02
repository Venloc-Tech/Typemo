import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts", validator: true })
export class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 2 })
  title!: string;

  @Prop(() => Number, { min: 0 })
  balance?: number;
}

@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
export class LedgerEntry extends Entity {
  @Prop(() => String, { required: true })
  note!: string;
}
