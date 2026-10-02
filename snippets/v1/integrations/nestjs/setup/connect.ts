import { Module } from "@nestjs/common";
import { TypemoModule } from "@venloc/typemo-nestjs";
// ---cut---
@Module({
  imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" })],
})
export class AppModule {}
