import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema()
export class Line {
  @Prop(() => String, { required: true })
  sku!: string;
}

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { min: 0 })
  balance?: number;

  @Prop(() => String, { enum: ["open", "frozen"] })
  status?: "open" | "frozen";

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => [Line])
  lines!: Line[];
}
