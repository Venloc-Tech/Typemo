const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank", monitorCommands: true });
TypemoOpenTelemetry.instrument(client, { commandSpans: true });
