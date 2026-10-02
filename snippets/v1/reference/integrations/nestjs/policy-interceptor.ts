import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { PolicyInterceptor } from "@venloc/typemo-nestjs";
@Module({})
class AppModule {}
// ---cut---
const app = await NestFactory.create(AppModule);
app.useGlobalInterceptors(
  new PolicyInterceptor({
    tenant: (request) => request.headers["x-tenant"],
    actor: (request) => request.headers["x-user"],
  }),
);
