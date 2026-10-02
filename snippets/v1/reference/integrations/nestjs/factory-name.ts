import { TypemoModule } from "@venloc/typemo-nestjs";
// ---cut---
// @errors: 2322
TypemoModule.forRootAsync({ useFactory: () => ({ uri: "mongodb://localhost:27017", name: "main" }) });
