import { TypemoClient } from "@venloc/typemo";
import { TypemoOpenTelemetry } from "@venloc/typemo-opentelemetry";

const client = await TypemoClient.connect("mongodb://localhost:27017", {
  dbName: "bank",
  monitorCommands: true, // needed only for commandSpans
});

const subscription = TypemoOpenTelemetry.instrument(client, { commandSpans: true });
// a span appears for every operation

subscription.unsubscribe();
// subscription removed, unfinished spans closed
