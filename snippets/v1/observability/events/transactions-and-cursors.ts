import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
// ---cut---
client.instrument({
  handle: (event) => {
    if (event.type === "transaction.retry") console.warn(`повтор транзакции ${event.transactionId}, попытка ${event.attempt}`);
    if (event.type === "transaction.abort") console.error(`откат транзакции ${event.transactionId}`);
  },
});
