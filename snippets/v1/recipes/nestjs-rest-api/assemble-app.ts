import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Entity, Prop, Schema } from "@venloc/typemo";
import { PolicyInterceptor, TypemoExceptionFilter, TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
class AccountsController {}
class AccountsService {}
// ---cut---
@Module({ imports: [TypemoModule.forFeature([Account])], controllers: [AccountsController], providers: [AccountsService] })
export class AccountsModule {}

@Module({ imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank", sync: "init" }), AccountsModule] })
export class AppModule {}

const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new TypemoExceptionFilter());
app.useGlobalInterceptors(new PolicyInterceptor({ tenant: (request) => request.headers["x-org"] }));
app.enableShutdownHooks();
await app.listen(3000);
