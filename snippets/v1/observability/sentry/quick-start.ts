import * as Sentry from "@sentry/node";
import { TypemoClient } from "@venloc/typemo";
import { TypemoSentry } from "@venloc/typemo-sentry";

Sentry.init({ dsn: "https://public@example.test/1" });

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
const subscription = TypemoSentry.instrument(client);
