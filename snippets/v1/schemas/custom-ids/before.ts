import { Prop, Schema } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "countries" })
class Country {
  @Prop(() => String, { required: true })
  _id!: string;

  @Prop(() => String, { required: true })
  name!: string;
}
