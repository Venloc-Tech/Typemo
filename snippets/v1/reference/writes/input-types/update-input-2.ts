import { type Defaulted, Entity, type Immutable, Prop, Schema, type CreateInput, type Replacement, type UpdateInput } from "@venloc/typemo";
@Schema()
class Line {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String) note?: string;
  @Prop(() => String, { immutable: true }) region?: Immutable<string>;
  @Prop(() => [Line]) lines!: Line[];
}
// ---cut---
type Patch = UpdateInput<Account>;
//   ^?
