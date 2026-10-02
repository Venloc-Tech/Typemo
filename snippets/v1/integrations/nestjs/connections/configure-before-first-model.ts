import { TypemoModule } from "@venloc/typemo-nestjs";
declare const auditSubscriber: import("@venloc/typemo").InstrumentationSubscriber;
// ---cut---
const database = TypemoModule.forRoot("mongodb://localhost:27017", {
  dbName: "bank",
  onClientCreate: (client) => {
    client.instrument(auditSubscriber);
  },
});
