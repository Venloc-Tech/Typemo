import { Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
@Injectable()
export class ArchiveService {
  constructor(@InjectModel(Account, { db: "archive" }) private readonly archived: Model<Account>) {}
}

@Module({ imports: [TypemoModule.forFeature([Account], { db: "archive" })], providers: [ArchiveService] })
export class ArchiveModule {}
