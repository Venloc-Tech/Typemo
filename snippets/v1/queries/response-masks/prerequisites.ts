import { Entity, Prop, Schema, Spec } from "@venloc/typemo";

@Schema()
export class Card {
  @Prop(() => String, { required: true })
  number!: string;

  @Prop(() => String)
  holder?: string;
}

@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => String, { nullable: true })
  phone!: string | null;

  @Prop(() => Number)
  age?: number;

  @Prop(() => [Card])
  cards!: Card[];

  @Prop(() => Spec.map(String))
  notes?: Map<string, string>;
}
