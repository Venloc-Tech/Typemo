import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { TypemoExceptionFilter } from "@venloc/typemo-nestjs";
@Module({})
class AppModule {}
// ---cut---
const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new TypemoExceptionFilter());
