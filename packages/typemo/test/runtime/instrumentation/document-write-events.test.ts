/*
 * A document write (`Model.create`, `doc.$save()`, `bulkSave`) casts and validates INSIDE its
 * operation, so a `ValidationError` there is an `operation.error` of that operation (with the model and
 * `failedStep: "validate"`), like the same failure of `insertOne`/`insertMany`. Nothing reaches the server.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ClientSession } from "mongodb";
import {
  Entity,
  type InstrumentationEvent,
  type Model,
  type OperationErrorEvent,
  type OperationStartEvent,
  Post,
  PostError,
  Pre,
  Prop,
  Schema,
  type SubscriberSensitive,
  type Subscription,
  ValidationError,
} from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("instr_docwrite");
let People: Model<Person>;
let subscriptions: Subscription[] = [];

/**
 * Subscribes and collects every event; `sensitive: "show"` gets the thrown error itself, any other mode a masked copy.
 * @param driverCommands Whether the subscriber also receives driver command events.
 * @param sensitive The subscriber's sensitivity mode.
 * @returns The array that receives the events.
 */
const collect = (driverCommands = false, sensitive: SubscriberSensitive = "mask"): InstrumentationEvent[] => {
  const events: InstrumentationEvent[] = [];
  subscriptions.push(t.client.instrument({ handle: (event) => events.push(event), driverCommands, sensitive }));
  return events;
};

/**
 * Keeps only the `operation.error` events.
 * @param events The collected events.
 * @returns The error events.
 */
const errors = (events: readonly InstrumentationEvent[]): OperationErrorEvent[] =>
  events.filter((event): event is OperationErrorEvent => event.type === "operation.error");

/**
 * A valid person document input.
 * @param name The person's name; also used for the email.
 * @returns The plain input for `create`.
 */
const person = (name: string) => ({ name, email: `${name}@x.test`, tags: [], pets: [], lastSeen: null });

beforeEach(() => {
  People = t.connection.model(Person);
});

afterEach(() => {
  for (const subscription of subscriptions) subscription.unsubscribe();
  subscriptions = [];
});

describe("document writes fail inside their operation", () => {
  test("Model.create with an invalid value: operation.error insertOne / ValidationError / validate", async () => {
    const events = collect(true, "show");
    const masked = collect();
    const error = await People.create({ ...person("Ann"), age: -1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    const failed = errors(events);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.operation).toBe("insertOne");
    expect(failed[0]?.model).toBe("Person");
    expect(failed[0]?.failedStep).toBe("validate");
    expect(failed[0]?.error).toBe(error);
    /* the default ("mask") subscriber gets a copy with the unmarked value masked */
    const copy = errors(masked)[0]?.error;
    expect(copy).toBeInstanceOf(ValidationError);
    expect((copy as ValidationError).issues[0]?.value).toBe("?");
    expect((error as ValidationError).issues[0]?.value).toBe(-1);
    expect(events.some((event) => event.type === "driver.command.started" && event.commandName === "insert")).toBe(
      false,
    );
    expect(await People.countDocuments({})).toBe(0);
  });

  test("doc.$save() of a new and of an existing document: the same error event (insertOne / updateOne)", async () => {
    const events = collect(false, "show");
    const fresh = People.new({ ...person("Bob"), age: -5 });
    const first = await fresh.$save().catch((caught: unknown) => caught);
    expect(first).toBeInstanceOf(ValidationError);

    const stored = await People.create(person("Cid"));
    stored.age = -2;
    const second = await stored.$save().catch((caught: unknown) => caught);
    expect(second).toBeInstanceOf(ValidationError);

    const failed = errors(events);
    expect(failed.map((event) => [event.operation, event.failedStep, event.error])).toEqual([
      ["insertOne", "validate", first],
      ["updateOne", "validate", second],
    ]);
    const reread = await People.findById(stored._id).lean();
    expect(reread?.age).toBeUndefined();
  });

  test("bulkSave with an invalid document: operation.error bulkWrite, nothing written", async () => {
    const events = collect();
    const good = People.new(person("Dan"));
    const bad = People.new({ ...person("Eve"), age: -1 });
    const error = await People.bulkSave([good, bad]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    const failed = errors(events);
    expect(failed.map((event) => [event.operation, event.model, event.failedStep])).toEqual([
      ["bulkWrite", "Person", "validate"],
    ]);
    expect(await People.countDocuments({})).toBe(0);
  });

  test("a valid save still emits start and end once", async () => {
    const events = collect();
    await People.create(person("Fay"));
    const kinds = events
      .filter(
        (event) =>
          event.type === "operation.start" || event.type === "operation.end" || event.type === "operation.error",
      )
      .map((event) => event.type);
    expect(kinds).toEqual(["operation.start", "operation.end"]);
  });
});

describe("OperationInfo.transactionId with an explicit transaction session", () => {
  test("an operation given the session outside the callback's async context still names its transaction", async () => {
    const events = collect();
    /* A worker started OUTSIDE the transaction: its async context has no ambient transaction. */
    let release: (session: ClientSession) => void = () => {};
    const handed = new Promise<ClientSession>((resolve) => {
      release = resolve;
    });
    const worker = handed.then((session) => People.countDocuments({}).session(session));
    let id: number | undefined;
    await t.connection.transaction(async (scope) => {
      id = scope.id;
      release(scope.session);
      await worker;
    });
    const count = events.find(
      (event): event is OperationStartEvent => event.type === "operation.start" && event.operation === "countDocuments",
    );
    expect(id).toBeNumber();
    expect(count?.transactionId).toBe(id);
    expect(count?.inTransaction).toBe(true);
  });
});

/**
 * An entity whose `pre('save')` hook can fail: a failing hook is an operation error too; an audited save whose
 * validation fails opens no transaction (the validation runs before it).
 */
@Schema({ collection: "instr_docwrite_hooked" })
class R31Hooked extends Entity {
  static trace: string[] = [];
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { min: 0 }) n?: number;

  @Pre("document.save") preSave(this: R31Hooked): void {
    R31Hooked.trace.push("pre");
    if (this.name === "boom") throw new Error("pre save refused");
  }
  @Post("document.save") postSave(this: R31Hooked): void {
    R31Hooked.trace.push("post");
  }
  @PostError("document.save") errorSave(this: R31Hooked, error: unknown): void {
    R31Hooked.trace.push(`postError ${(error as Error).message}`);
  }
}

/** An audited entity, to check that a failed validation opens no transaction. */
@Schema({ collection: "instr_docwrite_audited", audit: true })
class R31Audited extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { min: 0 }) n?: number;
}

describe("pre('save') failures and audited validation", () => {
  test("a throwing pre('save') hook: operation.error at hooksPre, postError once", async () => {
    const Hooked = t.connection.model(R31Hooked);
    R31Hooked.trace = [];
    const events = collect(true);
    const error = await Hooked.create({ name: "boom" }).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("pre save refused");
    const kinds = events.filter((event) => event.type.startsWith("operation.")).map((event) => event.type);
    /* the failure precedes `instrumentStart`, yet `operation.start` still opens it */
    expect(kinds).toEqual(["operation.start", "operation.error"]);
    const failed = errors(events);
    expect(failed.map((event) => [event.operation, event.model, event.failedStep, event.error])).toEqual([
      ["insertOne", "R31Hooked", "hooksPre", error],
    ]);
    expect(R31Hooked.trace).toEqual(["pre", "postError pre save refused"]);
    expect(events.some((event) => event.type === "driver.command.started" && event.commandName === "insert")).toBe(
      false,
    );

    const stored = await Hooked.create({ name: "fine" });
    stored.name = "boom";
    const second = await stored.$save().catch((caught: unknown) => caught);
    expect(errors(events).map((event) => [event.operation, event.failedStep, event.error])).toEqual([
      ["insertOne", "hooksPre", error],
      ["updateOne", "hooksPre", second],
    ]);

    const bulk = await Hooked.bulkSave([Hooked.new({ name: "ok" }), Hooked.new({ name: "boom" })]).catch(
      (caught: unknown) => caught,
    );
    expect(errors(events).at(-1)?.operation).toBe("bulkWrite");
    expect(errors(events).at(-1)?.failedStep).toBe("hooksPre");
    expect(errors(events).at(-1)?.error).toBe(bulk);
    expect(await Hooked.countDocuments({ name: "ok" })).toBe(0);
  });

  test("audited save / bulkSave failing validation: no transaction events, still operation.error", async () => {
    const Audited = t.connection.model(R31Audited);
    const events = collect();
    const first = await Audited.create({ name: "a", n: -1 }).catch((caught: unknown) => caught);
    expect(first).toBeInstanceOf(ValidationError);
    const bulk = await Audited.bulkSave([Audited.new({ name: "b" }), Audited.new({ name: "c", n: -1 })]).catch(
      (caught: unknown) => caught,
    );
    expect(bulk).toBeInstanceOf(ValidationError);
    expect(events.filter((event) => event.type.startsWith("transaction."))).toEqual([]);
    expect(errors(events).map((event) => [event.operation, event.failedStep])).toEqual([
      ["insertOne", "validate"],
      ["bulkWrite", "validate"],
    ]);
    /* A valid audited save still runs in its own transaction. */
    await Audited.create({ name: "d" });
    expect(events.some((event) => event.type.startsWith("transaction."))).toBe(true);
    expect(await Audited.countDocuments({})).toBe(1);
  });
});
