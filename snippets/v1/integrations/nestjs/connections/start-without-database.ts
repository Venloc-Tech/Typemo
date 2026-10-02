import { TypemoModule } from "@venloc/typemo-nestjs";
// ---cut---
const database = TypemoModule.forRoot("mongodb://localhost:27017", {
  dbName: "bank",
  lazyConnection: true,
  readyTimeoutMS: 2000,
});
