import { type Defaulted, Entity, Prop, Schema } from "@venloc/typemo"; // [!code highlight]

@Schema({ collection: "accounts" })
export class Account extends Entity {
  // …fields above

  @Prop(() => Number, { min: 0, default: 0 }) // [!code ++]
  balance!: Defaulted<number>; // [!code ++]
}
