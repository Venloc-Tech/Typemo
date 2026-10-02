import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank", monitorCommands: true });
const Accounts = client.db().model(Account);
// ---cut---
const SLOW_MS = 100;

const monitoring = client.instrument({
  driverCommands: true,
  handle: (event) => {
    switch (event.type) {
      case "operation.end":
        // slow operations
        if (event.durationMS > SLOW_MS) console.warn(`slow: ${event.model ?? event.database}.${event.operation}`);
        break;
      case "operation.error":
        // failed operations: the step and the kind of failure
        console.error(`${event.operation}: ${event.classification.name}, step ${event.failedStep}`);
        break;
      case "transaction.retry":
        console.warn(`transaction retry ${event.transactionId}`);
        break;
      case "driver.command.failed":
        console.error(`command ${event.commandName} failed on ${event.address}`);
        break;
    }
  },
});

await Accounts.find({ balance: { $gt: 50 } }).plain();

// on application shutdown
monitoring.unsubscribe();
