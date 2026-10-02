import { Injectable, Module } from "@nestjs/common";
import { TypemoModule, type TypemoModuleFactoryOptions } from "@venloc/typemo-nestjs";
@Injectable()
class Config {
  readonly mongoUri = "mongodb://localhost:27017";
}
@Module({ providers: [Config], exports: [Config] })
class ConfigModule {}
// ---cut---
@Module({
  imports: [
    TypemoModule.forRootAsync({
      name: "main",
      imports: [ConfigModule],
      inject: [Config],
      useFactory: (config: Config): TypemoModuleFactoryOptions => ({ uri: config.mongoUri, dbName: "bank" }),
    }),
  ],
})
export class AppModule {}
