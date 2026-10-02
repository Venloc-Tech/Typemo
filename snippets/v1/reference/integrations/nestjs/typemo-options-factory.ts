import { Injectable } from "@nestjs/common";
import type { TypemoModuleFactoryOptions, TypemoOptionsFactory } from "@venloc/typemo-nestjs";
// ---cut---
@Injectable()
export class DatabaseConfig implements TypemoOptionsFactory {
  createTypemoOptions(): TypemoModuleFactoryOptions {
    return { uri: "mongodb://localhost:27017", dbName: "bank" };
  }
}
