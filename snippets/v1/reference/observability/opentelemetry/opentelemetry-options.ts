TypemoOpenTelemetry.instrument(client, {
  stepSpans: true,
  poolMetrics: true,
  sensitive: "mask",
});
