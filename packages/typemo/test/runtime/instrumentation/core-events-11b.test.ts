/*
 * Instrumentation core fixes on the real server: the audit mask of `sensitive: "show"` in driver commands
 * (linked: masked, unlinked: redacted — never raw), the mask inside `$lookup.pipeline`, `$facet`,
 * `$set`/`$addFields` stages and for `dbName`-aliased fields, the real server address of the last command on
 * `operation.end`, and `ConfigurationError` for an invalid subscriber.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  Entity,
  type InstrumentationEvent,
  type InstrumentationSubscriber,
  type Model,
  ModelInternals,
  type OperationEndEvent,
  type OperationStartEvent,
  Prop,
  Schema,
  SENSITIVE_MASK,
  type Subscription,
} from "../../../src/internal.ts";
import { SensitiveMask } from "../../../src/policies/sensitive-mask.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** An entity with a masked (renamed) field and a hidden one. */
@Schema({ collection: "i11b_vaults" })
class Vault extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { sensitive: "mask", dbName: "pw" }) password?: string;
  @Prop(() => String, { sensitive: "hide" }) pin?: string;
}

const SECRET = "s3cr3t-value";
/* Not digits: a numeric pin could appear by chance inside `$clusterTime` of the command (a flaky false positive). */
const PIN = "pin-hidden-value";
const t = ModelLifecycle.useTypemo("instr11b");
let Vaults: Model<Vault>;
let subscriptions: Subscription[] = [];

/**
 * Subscribes and collects every event into an array.
 * @param options Extra subscriber options (everything except `handle`).
 * @returns The array that receives the events.
 */
const collect = (options: Omit<InstrumentationSubscriber, "handle"> = {}): InstrumentationEvent[] => {
  const events: InstrumentationEvent[] = [];
  subscriptions.push(t.client.instrument({ handle: (event) => events.push(event), ...options }));
  return events;
};

/**
 * The summaries of all `operation.start` events as one JSON text.
 * @param events The collected events.
 * @returns The serialized summaries.
 */
const summaries = (events: readonly InstrumentationEvent[]): string =>
  JSON.stringify(
    events.filter((event): event is OperationStartEvent => event.type === "operation.start").map((e) => e.summary),
  );

beforeEach(() => {
  Vaults = t.connection.model(Vault);
});

afterEach(() => {
  for (const subscription of subscriptions) subscription.unsubscribe();
  subscriptions = [];
});

describe("driver commands with sensitive: none", () => {
  test("a linked command carries the operation's audit mask (dbName alias too), never the raw secret", async () => {
    const events = collect({ sensitive: "show", driverCommands: true });
    await Vaults.create({ name: "a", password: SECRET, pin: PIN });
    await Vaults.find({ name: "a", password: SECRET });
    await Vaults.updateOne({ name: "a" }, { $set: { password: SECRET } });
    const commands = events.filter(
      (event) => event.type === "driver.command.started" && event.operationId !== undefined,
    );
    expect(commands.map((event) => (event.type === "driver.command.started" ? event.commandName : ""))).toEqual(
      expect.arrayContaining(["insert", "find", "update"]),
    );
    const text = JSON.stringify(commands.map((event) => (event.type === "driver.command.started" ? event.command : 0)));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PIN);
    expect(text).toContain(SENSITIVE_MASK);
    expect(text).toContain('"name":"a"'); /* non-secret values stay real */
  });

  test("an unlinked command (not issued by an operation) is redacted, not raw", async () => {
    const events = collect({ sensitive: "show", driverCommands: true });
    /* The client's own driver: its commands reach the listener, but no Typemo operation issued them. */
    await t.client.unsafeDriver().db(t.mongo.dbName).collection("i11b_vaults").findOne({ pw: SECRET });
    const raw = events.find(
      (event) =>
        event.type === "driver.command.started" && event.operationId === undefined && event.commandName === "find",
    );
    expect(raw).toBeDefined();
    expect(JSON.stringify(raw)).not.toContain(SECRET);
    expect(raw?.type === "driver.command.started" ? (raw.command as { filter: unknown }).filter : 0).toEqual({
      pw: "?",
    });
  });
});

describe("summary mask coverage with sensitive: none", () => {
  test("dbName-aliased secret in a filter", async () => {
    const events = collect({ sensitive: "show" });
    await Vaults.find({ password: SECRET });
    expect(summaries(events)).not.toContain(SECRET);
    expect(summaries(events)).toContain(SENSITIVE_MASK);
  });

  test("$lookup.pipeline, $facet, $set/$addFields literals and references to a secret", async () => {
    /*
     * The typed builder cannot express every raw stage: the mask the summary uses is checked on raw stages
     * directly, and on a real aggregate through the builder.
     */
    const raw = SensitiveMask.event(
      ModelInternals.schema(Vaults),
      [
        { $addFields: { password: SECRET, copy: "$password" } },
        { $set: { pw: SECRET } },
        { $lookup: { from: "i11b_vaults", as: "same", pipeline: [{ $match: { pw: SECRET } }] } },
        { $facet: { one: [{ $match: { password: SECRET } }], two: [{ $match: { name: "keep" } }] } },
      ],
      "show",
    );
    const direct = JSON.stringify(raw);
    expect(direct).not.toContain(SECRET);
    expect(direct).toContain('"name":"keep"');
    expect(direct).toContain('"copy":"?"');
    const events = collect({ sensitive: "show" });
    await Vaults.aggregate((p) => p.match({ password: SECRET, name: "keep" }));
    const text = summaries(events);
    expect(text).not.toContain(SECRET);
    expect(text).toContain('"name":"keep"');
  });
});

describe("server address of the last command", () => {
  test("operation.end reports the address of the operation's command", async () => {
    const events = collect({ driverCommands: true });
    await Vaults.countDocuments();
    const command = events.find((event) => event.type === "driver.command.started" && event.operationId !== undefined);
    const end = events.find((event): event is OperationEndEvent => event.type === "operation.end");
    const address = command?.type === "driver.command.started" ? command.address : "";
    expect(`${end?.serverAddress}:${end?.serverPort}`).toBe(address);
  });
});

describe("invalid subscribers", () => {
  test("a subscriber without handle, or with a non-function wrap, is a ConfigurationError", () => {
    // @ts-expect-error — handle is required
    expect(() => t.client.instrument({})).toThrow(ConfigurationError);
    // @ts-expect-error — wrap must be a function
    expect(() => t.client.instrument({ handle: () => {}, wrap: 1 })).toThrow(ConfigurationError);
  });
});
