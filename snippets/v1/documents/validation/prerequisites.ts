import { type Defaulted, Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, {
    required: true,
    validate: async (value: string) => value !== "bad" || "the name is taken",
  })
  name!: string;

  @Prop(() => Number, { min: 0, max: 10, default: 1 })
  size!: Defaulted<number>;

  @Prop(() => String, { enum: ["a", "b"] })
  kind?: "a" | "b";
}
