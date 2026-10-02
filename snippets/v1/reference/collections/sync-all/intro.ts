import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true, index: true })
  owner!: string;
}

@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
export class LedgerEntry extends Entity {
  @Prop(() => String, { required: true })
  note!: string;
}
