import { TypemoClient } from "@venloc/typemo";
import { TypemoOpenTelemetry } from "@venloc/typemo-opentelemetry";

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
const subscription = TypemoOpenTelemetry.instrument(client);
