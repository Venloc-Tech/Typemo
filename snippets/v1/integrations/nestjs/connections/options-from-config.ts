import { Injectable, Module } from "@nestjs/common";
import { TypemoModule, type TypemoModuleFactoryOptions, type TypemoOptionsFactory } from "@venloc/typemo-nestjs";
@Injectable()
class Config {
  readonly mongoUri = "mongodb://localhost:27017";
}
@Module({ providers: [Config], exports: [Config] })
class ConfigModule {}
// ---cut---
@Injectable()
export class DatabaseConfig implements TypemoOptionsFactory {
  constructor(private readonly config: Config) {}

  createTypemoOptions(): TypemoModuleFactoryOptions {
    return { uri: this.config.mongoUri, dbName: "bank" };
  }
}

const database = TypemoModule.forRootAsync({ imports: [ConfigModule], useClass: DatabaseConfig });
