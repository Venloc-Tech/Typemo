import { Module } from "@nestjs/common";
import { Entity, Prop, Schema } from "@venloc/typemo";
import { TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
@Module({ imports: [TypemoModule.forFeature([Account])] })
export class AccountsModule {}
