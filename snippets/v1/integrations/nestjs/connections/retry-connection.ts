import { TypemoModule } from "@venloc/typemo-nestjs";
// ---cut---
const database = TypemoModule.forRoot("mongodb://db:27017", { dbName: "bank", retryAttempts: 5, retryDelay: 1000 });
