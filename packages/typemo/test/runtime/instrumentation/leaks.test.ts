/*
 * Values of marked (`sensitive`) and `Hidden` fields never leave the process through server errors
 * (`DuplicateKeyError`, `ServerValidationError`, their `cause`), `driver.command.failed.failure`, the nested
 * command of `explain`, or the `projection` of a summary; unmarked values in errors inside EVENTS follow the
 * subscriber `sensitive`, the thrown error only the field marks.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  BulkWriteError,
  CastError,
  DuplicateKeyError,
  Entity,
  type InstrumentationEvent,
  type OperationStartEvent,
  Prop,
  Schema,
  ServerValidationError,
  type SubscriberSensitive,
  type Subscription,
  ValidationError,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s117_leaks");

/** A subdocument with a hidden card number. */
@Schema()
class LCard {
  @Prop(() => String, { sensitive: "hide" }) number?: string;
  @Prop(() => String) label?: string;
}

/** A person with a unique hidden email. */
@Schema({ collection: "s117_people" })
class LPerson extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true, unique: true, sensitive: "hide" }) email!: string;
  @Prop(() => Number, { min: 0 }) age?: number;
  @Prop(() => [LCard]) cards?: LCard[];
}

/** An entity with a masked field. */
@Schema({ collection: "s117_guarded" })
class LGuarded extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { sensitive: "mask" }) code?: string;
}

const EMAIL = "alice@secret.example";

let sub: Subscription | undefined;
afterEach(() => {
  sub?.unsubscribe();
  sub = undefined;
});

/**
 * Registers a collecting subscriber on the test client.
 * @param options Which optional event groups it receives and its sensitivity.
 * @returns The array that receives the events.
 */
const listen = (
  options: { readonly driverCommands?: boolean; readonly sensitive?: SubscriberSensitive } = {},
): InstrumentationEvent[] => {
  const events: InstrumentationEvent[] = [];
  sub = t.client.instrument({ handle: (event) => events.push(event), ...options });
  return events;
};

/**
 * Everything an error carries that a reporter could serialize: message, own fields, the `cause` chain.
 * @param error The error to flatten.
 * @returns All the text the error carries.
 */
const everything = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) parts.push(current.message, String(current.stack));
    try {
      parts.push(
        JSON.stringify(current, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value)),
      );
    } catch {
      parts.push(String(current));
    }
    for (const key of Object.keys(current as object)) parts.push(String((current as Record<string, unknown>)[key]));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join("\n");
};

/**
 * The first `operation.error` event.
 * @param events The collected events.
 * @returns The event; a missing one fails the test.
 */
const errorEvent = (events: readonly InstrumentationEvent[]): { error: unknown } => {
  const found = events.find((event) => event.type === "operation.error");
  if (found === undefined) throw new Error("no operation.error event");
  return found as { error: unknown };
};

describe("server errors of marked fields", () => {
  test("DuplicateKeyError: the thrown error, its cause, operation.error and driver.command.failed carry no value", async () => {
    const People = t.connection.model(LPerson);
    await People.createIndexes();
    await People.create({ name: "a", email: EMAIL });
    const events = listen({ driverCommands: true });
    const error = await People.create({ name: "b", email: EMAIL }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DuplicateKeyError);
    const duplicate = error as DuplicateKeyError;
    expect(duplicate.keyValue).toEqual({ email: "[hidden]" });
    /* The short message shows the masked key value; the full server text (masked the same way) is the serverMessage. */
    expect(duplicate.message).toBe('duplicate key on email_1: { email: "[hidden]" } (code 11000 DuplicateKey)');
    expect(duplicate.serverMessage).toContain('dup key: { email: "[hidden]" }');
    expect(duplicate.keyPattern).toEqual({ email: 1 });
    expect(duplicate.code).toBe(11000);
    expect(everything(duplicate)).not.toContain(EMAIL);
    expect(everything(errorEvent(events).error)).not.toContain(EMAIL);
  });

  test("driver.command.failed: a findAndModify duplicate key failure is a masked copy, never the driver error", async () => {
    const People = t.connection.model(LPerson);
    await People.createIndexes();
    await People.create({ name: "c", email: `3${EMAIL}` });
    for (const sensitive of ["mask", "show"] as const) {
      const events = listen({ driverCommands: true, sensitive });
      const error = await People.findOneAndUpdate(
        { name: "nobody" },
        { $set: { email: `3${EMAIL}` } },
        { upsert: true },
      ).catch((caught: unknown) => caught);
      sub?.unsubscribe();
      sub = undefined;
      expect(error).toBeInstanceOf(DuplicateKeyError);
      expect(everything(error)).not.toContain(EMAIL);
      const failed = events.filter((event) => event.type === "driver.command.failed");
      expect(failed.length).toBe(1);
      const failure = (failed[0] as { failure: unknown }).failure;
      expect(failure).toBeInstanceOf(Error);
      expect(everything(failure)).not.toContain(EMAIL);
      expect(everything(errorEvent(events).error)).not.toContain(EMAIL);
    }
  });

  test("BulkWriteError: every duplicate key failure, the message and the cause are masked (thrown and in events)", async () => {
    const People = t.connection.model(LPerson);
    await People.createIndexes();
    const events = listen();
    const error = await People.insertMany(
      [
        { name: "m1", email: `4${EMAIL}` },
        { name: "m2", email: `4${EMAIL}` },
      ],
      { ordered: false },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkWriteError);
    const bulk = error as BulkWriteError;
    expect(bulk.writeErrors).toHaveLength(1);
    expect(bulk.writeErrors[0]?.error).toBeInstanceOf(DuplicateKeyError);
    /* A bulk failure has no keyValue (the driver's WriteError lacks it): the "dup key" text is masked whole, and the
       short message of the classified error names no value. */
    expect(bulk.writeErrors[0]?.message).toContain("dup key: { ? }");
    expect(bulk.writeErrors[0]?.error.message).toBe("duplicate key on email_1 (code 11000 DuplicateKey)");
    expect(everything(bulk)).not.toContain(EMAIL);
    expect(everything(bulk.writeErrors[0]?.error)).not.toContain(EMAIL);
    expect(everything(errorEvent(events).error)).not.toContain(EMAIL);
  });

  test('DuplicateKeyError for a "show" subscriber: the field mark still wins', async () => {
    const People = t.connection.model(LPerson);
    await People.createIndexes();
    await People.create({ name: "a2", email: `2${EMAIL}` });
    const events = listen({ sensitive: "show" });
    await People.create({ name: "b2", email: `2${EMAIL}` }).catch(() => undefined);
    expect(everything(errorEvent(events).error)).not.toContain(EMAIL);
  });

  test("ServerValidationError: errInfo consideredValue of a marked field is masked (thrown and in events)", async () => {
    await t.mongo.db.createCollection("s117_guarded", {
      validator: { $jsonSchema: { properties: { code: { bsonType: "string", pattern: "^[0-9]+$" } } } },
    });
    const Guarded = t.connection.model(LGuarded);
    const events = listen({ driverCommands: true });
    const error = await Guarded.create({ name: "g", code: "SECRET-CODE" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerValidationError);
    expect(JSON.stringify((error as ServerValidationError).errInfo)).toContain('"consideredValue":"?"');
    expect(everything(error)).not.toContain("SECRET-CODE");
    expect(everything(errorEvent(events).error)).not.toContain("SECRET-CODE");
  });
});

describe("explain", () => {
  test("the nested command of explain is masked in driver.command.started", async () => {
    const People = t.connection.model(LPerson);
    const events = listen({ driverCommands: true, sensitive: "show" });
    await People.find({ email: "bob@secret.example", name: "bob" }).explain();
    const started = events.filter(
      (event) => event.type === "driver.command.started" && event.commandName === "explain",
    );
    expect(started.length).toBe(1);
    const text = JSON.stringify((started[0] as { command: unknown }).command);
    expect(text).not.toContain("bob@secret.example");
    expect(text).toContain('"email":"[hidden]"');
    /* A "show" subscriber still sees unmarked values: the nested command is walked, not blanked. */
    expect(text).toContain('"name":"bob"');
  });
});

describe("projection in the summary", () => {
  test("$elemMatch and $slice values are masked; inclusion flags stay", async () => {
    const People = t.connection.model(LPerson);
    const events = listen();
    await People.find({ name: "x" })
      /* cast: a projection operator with a value is outside the typed select() form */
      .select({ name: 1, cards: { $elemMatch: { number: "4111-1111" } } } as never)
      .lean();
    const start = events.find((event) => event.type === "operation.start") as OperationStartEvent;
    const text = JSON.stringify(start.summary.projection);
    expect(text).not.toContain("4111-1111");
    expect(text).toContain('"number":"[hidden]"');
    expect(text).toContain('"name":1');
  });
});

describe("unmarked values in errors inside events", () => {
  test('CastError: "?" in the event of a "mask" subscriber, the thrown error keeps the value', async () => {
    const People = t.connection.model(LPerson);
    const events = listen();
    /* cast: a wrong type on purpose (the cast must fail at run time) */
    const error = await People.find({ age: "UNMARKED-SECRET" as never })
      .lean()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).value).toBe("UNMARKED-SECRET");
    const shown = errorEvent(events).error;
    expect(shown).toBeInstanceOf(CastError);
    expect((shown as CastError).value).toBe("?");
    expect(everything(shown)).not.toContain("UNMARKED-SECRET");
  });

  test('CastError: a "show" subscriber gets the thrown error as is; "hide" gets "[hidden]"', async () => {
    const People = t.connection.model(LPerson);
    const shownEvents: InstrumentationEvent[] = [];
    const hiddenEvents: InstrumentationEvent[] = [];
    const one = t.client.instrument({ handle: (event) => shownEvents.push(event), sensitive: "show" });
    const two = t.client.instrument({ handle: (event) => hiddenEvents.push(event), sensitive: "hide" });
    /* cast: a wrong type on purpose */
    await People.find({ age: "RAW-7" as never })
      .lean()
      .catch(() => undefined);
    one.unsubscribe();
    two.unsubscribe();
    expect((errorEvent(shownEvents).error as CastError).value).toBe("RAW-7");
    expect((errorEvent(hiddenEvents).error as CastError).value).toBe("[hidden]");
  });

  test('ValidationError: issue values and messages masked in the event of a "mask" subscriber', async () => {
    const People = t.connection.model(LPerson);
    const events = listen();
    const error = await People.insertOne({ name: "v", email: "v@x.test", age: -987654 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues[0]?.value).toBe(-987654);
    const shown = errorEvent(events).error;
    expect(shown).toBeInstanceOf(ValidationError);
    expect((shown as ValidationError).issues[0]?.value).toBe("?");
    expect(everything(shown)).not.toContain("987654");
  });
});
