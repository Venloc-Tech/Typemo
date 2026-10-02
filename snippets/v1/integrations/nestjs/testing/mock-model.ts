import { Entity, Prop, Schema } from "@venloc/typemo";
import { provideModelMock } from "@venloc/typemo-nestjs/testing";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
// @errors: 2353
provideModelMock(Account, { countAll: async () => 3 });
