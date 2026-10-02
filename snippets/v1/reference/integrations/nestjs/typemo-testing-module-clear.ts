import { afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { Entity, Prop, Schema } from "@venloc/typemo";
import { TypemoModule } from "@venloc/typemo-nestjs";
import { TypemoTestingModule } from "@venloc/typemo-nestjs/testing";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
const moduleRef = await Test.createTestingModule({
  imports: [TypemoTestingModule.forRoot("mongodb://localhost:27017"), TypemoModule.forFeature([Account])],
}).compile();
await moduleRef.init();
afterEach(() => TypemoTestingModule.clear(moduleRef));
