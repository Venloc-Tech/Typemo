import { TypemoClient } from "@venloc/typemo";
// ---cut---
const client = new TypemoClient("mongodb://localhost:27017", {
  dbName: "app",
  name: "main",
  readyTimeoutMS: 5_000,
  timeoutMS: 30_000,
  maxPoolSize: 20,
});
