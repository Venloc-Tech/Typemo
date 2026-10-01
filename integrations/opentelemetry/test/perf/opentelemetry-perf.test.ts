// Perf guard: the OpenTelemetry adapter with a real SDK and a no-op exporter against no subscriber.
// Generous threshold — it catches a regression by multiples (a leak, an eager summary), not by percents.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, NoopSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BsonOptions, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { MongoHarness, MongoLifecycle } from "@venloc/typemo-test-kit";
import { TypemoOpenTelemetry } from "../../src/index.ts";

@Schema({ collection: "otel_perf" })
class PerfDoc extends Entity {
  @Prop(() => Number, { required: true }) n!: number;
}

const mongo = MongoLifecycle.useMongo("otelperf", BsonOptions.apply({}));
let client: TypemoClient;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

beforeAll(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  client = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName });
  await client.connect();
});

afterAll(async () => {
  await client.close();
  context.disable();
});

test("findOne lean by _id: the OTel adapter (no-op exporter) costs at most 2× + 0.5 ms over no subscriber", async () => {
  const Docs = client.connection.model(PerfDoc);
  const created = await Docs.create({ n: 1 });
  const one = () => Docs.findOne({ _id: created._id }).lean().exec();
  const tracerProvider = new BasicTracerProvider({ spanProcessors: [new NoopSpanProcessor()] });
  const meterProvider = new MeterProvider();
  const times = { none: [] as number[], otel: [] as number[] };
  for (let i = 0; i < 50; i++) await one(); // warm-up
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 60; i++) {
      const at = performance.now();
      await one();
      times.none.push(performance.now() - at);
    }
    const subscription = TypemoOpenTelemetry.instrument(client, { tracerProvider, meterProvider });
    for (let i = 0; i < 60; i++) {
      const at = performance.now();
      await one();
      times.otel.push(performance.now() - at);
    }
    subscription.unsubscribe();
  }
  const none = median(times.none);
  const otel = median(times.otel);
  console.log(`[perf] findOne lean by _id: no subscriber ${none.toFixed(3)} ms, OTel adapter ${otel.toFixed(3)} ms`);
  expect(otel).toBeLessThanOrEqual(none * 2 + 0.5);
});
