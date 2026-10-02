import { TypemoModule } from "@venloc/typemo-nestjs";
// ---cut---
const analytics = TypemoModule.forRootAsync({
  name: "analytics",
  useFactory: () => ({ uri: "mongodb://localhost:27017", dbName: "analytics" }),
});
