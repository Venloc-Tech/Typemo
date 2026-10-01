/*
 * Group P — change streams: how fast each contestant CONSUMES a burst of events. One run: note the cluster
 * time, open the stream at it (`startAtOperationTime`, so no event is missed while the cursor opens), a
 * separate producer client (its own pool, the same for everyone) writes E documents, the consumer reads until
 * it has E events, the stream is closed. The timed run is the whole cycle; `eventsPerSec` in metrics is E per
 * second from the first write to the last event consumed.
 *  - P.stream.insert: E inserts (the event carries the document).
 *  - P.stream.update.lookup: E updates (one per document) with `fullDocument: "updateLookup"`.
 * Contestants: driver (raw events), Mongoose `Model.watch(…, { hydrate: true })`, Typemo `watch({ hydrate: true })`
 * (typemo) and without hydration (typemo-lean): the difference is the cost of hydrating `fullDocument`.
 * Verified: E events, the sum of `n` over the event documents.
 */
import "reflect-metadata";
import { Entity, Prop, Schema } from "@venloc/typemo";
import { type AnyBulkWriteOperation, type Db, type Document, MongoClient, type Timestamp } from "mongodb";
import { ConnectionDefaults } from "../adapters/bench-context.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { ISeed } from "./support-bb/populate-models.ts";

/** The collection the events are written to. */
const P_EVENTS = "bb_p_events";
/** Events per dataset size. */
const EVENTS_OF: Readonly<Record<SizeName, number>> = { T: 200, S: 2_000, M: 20_000, L: 20_000, XL: 20_000 };
/** The key of the producer client in the scenario state. */
const PRODUCER = "bbProducer";
/** The collection used to get a write optime. */
const P_MARK = "bb_p_mark";

/** The document that is written and watched. */
@Schema({ collection: P_EVENTS })
class PEvent extends Entity {
  @Prop(() => Number, { required: true })
  n!: number;

  @Prop(() => String, { required: true })
  label!: string;

  @Prop(() => Number)
  v?: number;
}

/**
 * What one run consumed.
 *
 * @example
 * ```ts
 * const run: StreamRun = { events: 2000, sum: 1999000, ms: 350 };
 * ```
 */
interface StreamRun {
  /** Events consumed. */
  readonly events: number;
  /** Sum of `n` over the event documents. */
  readonly sum: number;
  /** Milliseconds from the first write to the last event. */
  readonly ms: number;
}

/**
 * What every consumer is reduced to: next event (or null when closed) and close.
 *
 * @example
 * ```ts
 * const event = await consumer.next();
 * await consumer.close();
 * ```
 */
interface Consumer {
  /**
   * The next event.
   *
   * @returns The event, or `null` when the stream is closed.
   */
  next(): Promise<unknown>;
  /**
   * Closes the stream.
   *
   * @returns Resolves when closed.
   */
  close(): Promise<void>;
}

/**
 * What the producer writes.
 *
 * @example
 * ```ts
 * const kind: Kind = "update";
 * ```
 */
type Kind = "insert" | "update";

/** One change-stream scenario: a burst of events consumed by each contestant. */
class StreamScenario extends Scenario {
  readonly id: string;
  readonly group = "P" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo", "typemo-lean"];
  override readonly iterations = { warmup: 1, minSamples: 3, maxSamples: 6, maxTimeMs: 3_000 };
  override readonly notes =
    "Producer: a separate MongoClient (bulk writes of 500). Mongoose and Typemo hydrate fullDocument; typemo-lean does not. " +
    "S = 2k events, M = 20k (full).";

  /**
   * @param streamKind - Whether the burst is inserts or updates.
   */
  constructor(private readonly streamKind: Kind) {
    super();
    this.id = streamKind === "insert" ? "P.stream.insert" : "P.stream.update.lookup";
    this.title =
      streamKind === "insert"
        ? "change stream: consume E insert events"
        : "change stream: E update events, fullDocument updateLookup";
    this.profiles = streamKind === "insert" ? ["quick", "standard", "full"] : ["standard", "full"];
  }

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns S and M for `full`, S otherwise; none when the profile does not run the scenario.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    if (!this.profiles.includes(profile)) return [];
    return profile === "full" ? ["S", "M"] : ["S"];
  }

  /**
   * Events per operation.
   *
   * @param size - The dataset size.
   * @returns The number of events.
   */
  override unitsPerOp(size: SizeName): number {
    return EVENTS_OF[size];
  }

  /**
   * The producer client opened by `prepare`.
   *
   * @param env - The scenario environment.
   * @returns The client.
   * @throws Error - When `prepare` did not run.
   */
  private producer(env: ScenarioEnv): MongoClient {
    const client = env.state.get(PRODUCER);
    if (!(client instanceof MongoClient)) throw new Error("P: the producer client is not open (prepare did not run)");
    return client;
  }

  /**
   * Opens the producer client and empties (or, for updates, seeds) the collections.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    const producer = new MongoClient(ConnectionDefaults.uri(), { maxPoolSize: 4 });
    await producer.connect();
    env.state.set(PRODUCER, producer);
    const events = EVENTS_OF[env.size];
    for (const contestant of this.contestants) {
      const collection = producer.db(env.ctx.dbOf(contestant).databaseName).collection(P_EVENTS);
      await collection.deleteMany({});
      if (this.streamKind === "update")
        await collection.insertMany(
          Array.from({ length: events }, (_, i) => ({ _id: ISeed.oid(0x70, i), n: i, label: `e${i}`, v: 0 })),
        );
    }
  }

  /**
   * Closes the producer client.
   *
   * @param env - The scenario environment.
   */
  override async cleanup(env: ScenarioEnv): Promise<void> {
    await this.producer(env).close();
    env.state.delete(PRODUCER);
  }

  /**
   * The writes of one run, through the producer; resolves when all are acknowledged.
   *
   * @param db - The producer's view of the contestant's database.
   * @param events - How many events to produce.
   */
  private async produce(db: Db, events: number): Promise<void> {
    const collection = db.collection(P_EVENTS);
    for (let start = 0; start < events; start += 500) {
      const count = Math.min(500, events - start);
      if (this.streamKind === "insert") {
        await collection.insertMany(
          Array.from({ length: count }, (_, k) => ({ n: start + k, label: `e${start + k}` })),
          { ordered: false },
        );
      } else {
        const ops: AnyBulkWriteOperation<Document>[] = Array.from({ length: count }, (_, k) => ({
          /* $inc: always a change (a $set of an equal value would emit no event). */
          updateOne: { filter: { _id: ISeed.oid(0x70, start + k) }, update: { $inc: { v: 1 } } },
        }));
        await collection.bulkWrite(ops, { ordered: false });
      }
    }
  }

  /**
   * Builds a contestant that produces a burst and consumes its events.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const events = EVENTS_OF[env.size];
    const producerDb = this.producer(env).db(env.ctx.dbOf(contestant).databaseName);
    const lookup = this.streamKind === "update";
    const open = (at: Timestamp): Consumer => {
      switch (contestant) {
        case "driver":
          return env.ctx.driver.db
            .collection(P_EVENTS)
            .watch([], { startAtOperationTime: at, ...(lookup ? { fullDocument: "updateLookup" } : {}) });
        case "mongoose": {
          const Events = env.ctx.mongoose.model(
            "BbPEvent",
            P_EVENTS,
            (m) =>
              new m.Schema({ n: { type: Number, required: true }, label: { type: String, required: true }, v: Number }),
          );
          return Events.watch([], {
            hydrate: true,
            startAtOperationTime: at,
            ...(lookup ? { fullDocument: "updateLookup" } : {}),
          }) as unknown as Consumer;
        }
        default: {
          const handle = contestant === "typemo" ? env.ctx.typemo : env.ctx.typemoLean;
          const Events = handle.model(PEvent);
          const pending: Promise<unknown> = handle.lean
            ? lookup
              ? Events.watch({ startAtOperationTime: at, fullDocument: "updateLookup" })
              : Events.watch({ startAtOperationTime: at })
            : lookup
              ? Events.watch({ hydrate: true, startAtOperationTime: at, fullDocument: "updateLookup" })
              : Events.watch({ hydrate: true, startAtOperationTime: at });
          /* Typemo's watch() resolves to the stream: adapt the promise to the Consumer shape. */
          let stream: Consumer | undefined;
          const ready = pending.then((s) => {
            stream = s as unknown as Consumer;
            return stream;
          });
          return {
            next: async () => (stream ?? (await ready)).next(),
            close: async () => (stream ?? (await ready)).close(),
          };
        }
      }
    };
    return ScenarioKit.impl<StreamRun>({
      run: async () => {
        /* The optime of a WRITE: a ping may answer an older (majority) time and the stream would then
           replay the tail of the previous run. */
        const mark = await producerDb.command({
          update: P_MARK,
          updates: [{ q: { _id: "mark" }, u: { $inc: { n: 1 } }, upsert: true }],
        });
        const stream = open(mark.operationTime as Timestamp);
        const started = performance.now();
        const writes = this.produce(producerDb, events);
        /* A missed event must fail the run, not hang it: close the stream after 30 s. */
        const watchdog = setTimeout(() => void stream.close(), 30_000);
        let seen = 0;
        let sum = 0;
        try {
          while (seen < events) {
            const event = (await stream.next()) as { operationType?: string; fullDocument?: { n?: unknown } } | null;
            if (event === null) throw new Error(`${contestant}: the stream closed after ${seen} events`);
            if (event.operationType !== this.streamKind) continue;
            seen++;
            sum += Number(event.fullDocument?.n);
          }
          await writes;
        } finally {
          clearTimeout(watchdog);
          await stream.close();
        }
        return { events: seen, sum, ms: performance.now() - started };
      },
      verify: (result): Outcome => {
        const expected = (events * (events - 1)) / 2;
        if (result.events !== events || result.sum !== expected)
          throw new Error(`${contestant}: ${result.events} events, Σn ${result.sum} (expected ${events}, ${expected})`);
        return {
          count: result.events,
          checksum: `sum=${result.sum}`,
          metrics: { eventsPerSec: Math.round((result.events / result.ms) * 1000) },
        };
      },
    });
  }
}

/** The scenarios of group P. */
export const SCENARIOS: readonly Scenario[] = [new StreamScenario("insert"), new StreamScenario("update")];
