/*
 * The field option `sensitive` on the real server: in events (subscriber "mask"/"show"), in linked driver
 * commands and in the audit trail; `Hidden` unmarked = mask; dbName; a mask function (typed by the field) and
 * a throwing one; the container check.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  AuditError,
  CastError,
  ConfigurationError,
  Entity,
  fn,
  type Hidden,
  Index,
  type InstrumentationEvent,
  type InstrumentationSubscriber,
  type Model,
  type OperationStartEvent,
  Prop,
  Schema,
  SENSITIVE_HIDDEN,
  type Subscription,
  type TransactionEvent,
  ValidationError,
} from "../../../src/index.ts";
import { SensitiveMask } from "../../../src/policies/sensitive-mask.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A subdocument used as a marked container field. */
@Schema()
class Card {
  @Prop(() => String) holder?: string;
}

/** A user with a field for every `sensitive` mode and for `Hidden` with and without a mark. */
@Schema({ collection: "s115_users" })
class SUser extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { sensitive: "mask" }) password?: string;
  @Prop(() => String, { sensitive: "hide" }) internal?: string;
  @Prop(() => String, { sensitive: { mask: (value: string) => `${value.slice(0, 2)}***` } }) email?: string;
  @Prop(() => String, { sensitive: "show", hidden: true }) shownHidden?: Hidden<string>;
  @Prop(() => String, { hidden: true }) token?: Hidden<string>;
  @Prop(() => String, { sensitive: "mask", dbName: "pw2" }) alias?: string;
  @Prop(() => Card, { sensitive: "mask" }) card?: Card;
  @Prop(() => Number, { sensitive: "mask" }) age?: number;
  @Prop(() => String, { sensitive: "mask", enum: ["alpha", "beta"] }) code?: "alpha" | "beta";
  @Prop(() => Number, { sensitive: "hide" }) level?: number;
  @Prop(() => String, { sensitive: "hide", enum: ["gold", "silver"] }) tier?: "gold" | "silver";
}

/** A field whose error mask throws (forError). */
@Schema({ collection: "s117_throw_cast" })
class SThrowCast extends Entity {
  @Prop(() => Number, {
    sensitive: {
      mask: (): string => {
        throw new Error("mask-boom");
      },
    },
  })
  n?: number;
}

/** An audited entity with a function mask, a hidden field and a throwing mask. */
@Schema({ collection: "s115_audited", audit: true })
class SAudited extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { sensitive: { mask: (value: string) => value.length } }) pin?: string;
  @Prop(() => String, { hidden: true }) note?: Hidden<string>;
  @Prop(() => String, {
    sensitive: {
      mask: (): string => {
        throw new Error("boom");
      },
    },
  })
  bad?: string;
}

/** Duplicate keys on an unmarked and on a marked field, inside a transaction. */
@Schema({ collection: "s117d_tx" })
@Index({ handle: 1 }, { unique: true })
@Index({ secret: 1 }, { unique: true })
class STx extends Entity {
  @Prop(() => String) handle?: string;
  @Prop(() => String, { sensitive: "mask" }) secret?: string;
}

/** A unique field whose mask throws — a duplicate key error is masked before `emit`. */
@Schema({ collection: "s117_throw_dup" })
@Index({ key: 1 }, { unique: true })
class SThrowDup extends Entity {
  @Prop(() => String, {
    sensitive: {
      mask: (): string => {
        throw new Error("mask-boom");
      },
    },
  })
  key?: string;
}

const t = ModelLifecycle.useTypemo("sens115");
let Users: Model<SUser>;
let Audited: Model<SAudited>;
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
 * The `operation.start` event of an operation.
 * @param events The collected events.
 * @param operation The operation name to look for.
 * @returns The start event; a missing one fails the test.
 */
const startOf = (events: readonly InstrumentationEvent[], operation: string): OperationStartEvent => {
  const found = events.find(
    (event): event is OperationStartEvent => event.type === "operation.start" && event.operation === operation,
  );
  if (found === undefined) throw new Error(`no start of ${operation}`);
  return found;
};

/** The event emitted when a mask function fails. */
type MaskFailureEvent = Extract<InstrumentationEvent, { readonly type: "instrumentation.error" }>;
/**
 * Keeps only the `instrumentation.error` events.
 * @param events The collected events.
 * @returns The mask failure events.
 */
const failuresOf = (events: readonly InstrumentationEvent[]): MaskFailureEvent[] =>
  events.filter((event): event is MaskFailureEvent => event.type === "instrumentation.error");

beforeEach(() => {
  Users = t.connection.model(SUser);
  Audited = t.connection.model(SAudited);
});
afterEach(() => {
  for (const one of subscriptions) one.unsubscribe();
  subscriptions = [];
});

const FILTER = {
  name: "ann",
  password: "p4ss",
  internal: "int",
  email: "ann@x.test",
  token: "tok",
  shownHidden: "vis",
  alias: "al1",
  "card.holder": "Ann Card",
};

describe("events (subscriber show / mask)", () => {
  test('"show": unmarked real, mask → "?", hide → "[hidden]", fn → its result, Hidden unmarked → "?", dbName', async () => {
    const events = collect({ sensitive: "show" });
    await Users.find(FILTER);
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.name).toBe("ann");
    expect(filter.password).toBe("?");
    expect(filter.internal).toBe("[hidden]");
    expect(filter.email).toBe("an***");
    expect(filter.token).toBe("?");
    expect(filter.shownHidden).toBe("vis");
    expect(filter.pw2).toBe("?");
    expect(filter["card.holder"]).toBe("?");
    expect(JSON.stringify(filter)).not.toContain("p4ss");
  });

  test('"mask" (default): every value "?", a "hide" field is "[hidden]"', async () => {
    const events = collect();
    await Users.find(FILTER);
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.name).toBe("?");
    expect(filter.internal).toBe("[hidden]");
  });

  test("fn on $in elements and $eq; $regex → ?", async () => {
    const events = collect({ sensitive: "show" });
    await Users.find({ email: { $in: ["bob@x", "cid@x"] }, password: { $regex: "^p" } });
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.email).toEqual({ $in: ["bo***", "ci***"] });
    expect(filter.password).toBe("?");
  });

  test("aggregate $match and the linked driver command are masked", async () => {
    const events = collect({ sensitive: "show", driverCommands: true });
    /* $lookup.pipeline / $facet with the same walker: core-events-11b.test.ts */
    await Users.aggregate((p) => p.match({ password: "p4ss", internal: "int" }));
    const text = JSON.stringify(events);
    expect(text).not.toContain("p4ss");
    expect(text).not.toContain('"int"');
  });

  test("a throwing fn read in the lazy summary AFTER handle is an instrumentation.error event", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const events = collect({ sensitive: "show" });
      await Audited.find({ bad: "x-secret" });
      /* Read after the operation, outside `emit`: the hub's sink was captured when the event was built. */
      const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
      expect(filter.bad).toBe("?");
      const failures = failuresOf(events);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.model).toBe("SAudited");
      expect(failures[0]?.path).toBe("bad");
      expect(JSON.stringify({ ...failures[0], error: String(failures[0]?.error) })).not.toContain("x-secret");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("the summary read after every subscriber left falls back to console.error once", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const events = collect({ sensitive: "show" });
      await Audited.find({ bad: "x" });
      for (const one of subscriptions) one.unsubscribe();
      subscriptions = [];
      expect((startOf(events, "find").summary.filter as Record<string, unknown>).bad).toBe("?");
      expect(failuresOf(events)).toHaveLength(0);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        '[typemo] instrumentation: a sensitive mask threw; the value is "?"',
        expect.any(Error),
      );
    } finally {
      log.mockRestore();
    }
  });

  test("a mask failure while a subscriber shapes the event is an instrumentation.error event", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const events: InstrumentationEvent[] = [];
      subscriptions.push(
        t.client.instrument({
          sensitive: "show",
          /* Reads the lazy summary inside `handle` (as the adapters do): the failure goes to the hub. */
          handle: (event) => {
            if (event.type === "operation.start") void event.summary;
            events.push(event);
          },
        }),
      );
      await Audited.find({ bad: "s3cr3t-value" });
      expect((startOf(events, "find").summary.filter as Record<string, unknown>).bad).toBe("?");
      const failures = events.filter((event) => event.type === "instrumentation.error");
      expect(failures).toHaveLength(1);
      const failure = failures[0];
      if (failure?.type !== "instrumentation.error") throw new Error("no instrumentation.error");
      expect(failure.source).toBe("sensitive-mask");
      expect(failure.model).toBe("SAudited");
      expect(failure.path).toBe("bad");
      expect(failure.error).toBeInstanceOf(Error);
      /* The error names the path, never the value, and does not carry the mask's own error. */
      expect(JSON.stringify({ ...failure, error: String(failure.error) })).not.toContain("s3cr3t");
      expect((failure.error as Error).cause).toBeUndefined();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("events (subscriber hide / function, field modes win)", () => {
  test('"mask": a field function keeps its result, "show" field real, Hidden unmarked "?"', async () => {
    const events = collect();
    await Users.find(FILTER);
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.name).toBe("?");
    expect(filter.email).toBe("an***");
    expect(filter.shownHidden).toBe("vis");
    expect(filter.token).toBe("?");
    expect(filter.password).toBe("?");
    expect(filter.internal).toBe("[hidden]");
  });

  test('"hide": unmarked values are "[hidden]"; marked mask/fn/show keep their mode', async () => {
    const events = collect({ sensitive: "hide" });
    await Users.find({ ...FILTER, age: { $gt: 3 } });
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.name).toBe("[hidden]");
    expect(filter.internal).toBe("[hidden]");
    expect(filter.password).toBe("?");
    expect(filter.email).toBe("an***");
    expect(filter.shownHidden).toBe("vis");
    expect(filter.token).toBe("?");
    expect(filter.age).toBe("?");
    expect(JSON.stringify(filter)).not.toContain("ann");
  });

  test('"hide": a field condition collapses whole into "[hidden]", operators not shown', async () => {
    const events = collect({ sensitive: "hide" });
    await Users.find({ name: { $gt: "a", $lt: "z" }, password: "p4ss" });
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.name).toBe("[hidden]");
    expect(filter.password).toBe("?");
  });

  test('"hide": $or/$and/$nor keep every branch, hidden fields are "[hidden]"', async () => {
    const events = collect({ sensitive: "hide" });
    await Users.find({ $or: [{ name: { $gt: "a" } }] });
    expect(startOf(events, "find").summary.filter).toEqual({ $or: [{ name: "[hidden]" }] });
    await Users.find({
      $and: [{ name: "ann" }, { password: "p4ss" }],
      $nor: [{ name: { $in: ["x"] } }, { internal: "i" }],
    });
    expect(events.filter((event) => event.type === "operation.start").at(-1)).toMatchObject({
      summary: {
        filter: {
          $and: [{ name: "[hidden]" }, { password: "?" }],
          $nor: [{ name: "[hidden]" }, { internal: "[hidden]" }],
        },
      },
    });
  });

  test('"hide": the same inside $match stages, every stage kept', async () => {
    const events = collect({ sensitive: "hide" });
    await Users.aggregate((p) =>
      p.match({ $or: [{ name: { $gt: "a" } }] }).match({ $or: [{ name: "ann" }, { password: "p4ss" }] }),
    );
    /* The leading `$unset` is the core's exclusion of `Hidden` fields: its operand (field names) is a value too. */
    expect(startOf(events, "aggregate").summary.pipeline).toEqual([
      { $unset: "[hidden]" },
      { $match: { $or: [{ name: "[hidden]" }] } },
      { $match: { $or: [{ name: "[hidden]" }, { password: "?" }] } },
    ]);
  });

  test("a subscriber function gets (value, { path }) for unmarked values only; a throw is ? and logged", async () => {
    const seen: string[] = [];
    const events = collect({
      sensitive: {
        mask: (value, { path }) => {
          seen.push(path);
          return `<${path}:${String(value).length}>`;
        },
      },
    });
    await Users.find({ name: "ann", password: "p4ss", email: "ann@x.test" });
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.name).toBe("<name:3>");
    expect(filter.password).toBe("?");
    expect(filter.email).toBe("an***");
    expect(seen).toEqual(["name"]);
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = collect({
        sensitive: {
          mask: () => {
            throw new Error("boom");
          },
        },
      });
      await Users.find({ name: "bob" });
      expect((startOf(failing, "find").summary.filter as Record<string, unknown>).name).toBe("?");
      /* Read after `handle`, the failure still reaches the subscribers, not the console. */
      const failures = failuresOf(failing);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.model).toBe("SUser");
      expect(failures[0]?.path).toBe("name");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("linked driver command: the field function result under the default mask", async () => {
    const events = collect({ driverCommands: true });
    await Users.find({ email: "ann@x.test", name: "ann" });
    const started = events.find(
      (event) =>
        event.type === "driver.command.started" && event.commandName === "find" && event.operationId !== undefined,
    );
    const filter = (started as { command: { filter: Record<string, unknown> } }).command.filter;
    expect(filter.email).toBe("an***");
    expect(filter.name).toBe("?");
  });
});

describe("audit trail", () => {
  test("an unmarked Hidden field is masked in the audit trail", async () => {
    await Audited.create({ name: "h", note: "top-secret-note" });
    const entries = await t.mongo.db.collection("s115_audited_audit").find({}).toArray();
    const text = JSON.stringify(entries);
    expect(text).not.toContain("top-secret-note");
    expect(text).toContain('"note":"?"');
  });

  test("fn result recorded; a throwing fn fails the write (AuditError, rolled back)", async () => {
    /* Not digits: a numeric pin could appear by chance inside an ObjectId or a date of the entry (flaky). */
    await Audited.create({ name: "a", pin: "pin-secret" });
    const entries = await t.mongo.db.collection("s115_audited_audit").find({}).toArray();
    expect(JSON.stringify(entries)).not.toContain("pin-secret");
    const failure = await Audited.create({ name: "b", bad: "x" }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AuditError);
    expect(await Audited.countDocuments({ name: "b" })).toBe(0);
  });
});

describe("schema checks", () => {
  test("a mask function on a subdocument is a ConfigurationError; an unknown value too", () => {
    @Schema({ collection: "s115_bad1" })
    class Bad1 extends Entity {
      // @ts-expect-error the mask of a Card gets a Card, not a string
      @Prop(() => Card, { sensitive: { mask: (value: string) => value } }) card?: Card;
    }
    expect(() => t.connection.model(Bad1)).toThrow(ConfigurationError);
    @Schema({ collection: "s115_bad2" })
    class Bad2 extends Entity {
      // @ts-expect-error "omit" is not a sensitive mode (the old audit option)
      @Prop(() => String, { sensitive: "omit" }) x?: string;
    }
    expect(() => t.connection.model(Bad2)).toThrow(ConfigurationError);
  });
});

describe("errors", () => {
  test("a throwing error mask: CastError shows ?, the failure is reported (not swallowed)", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const Model = t.connection.model(SThrowCast);
      /* A number that fails the cast (not finite): a value of the declared type, so the mask is called and throws. */
      const error = await Model.find({ n: Number.POSITIVE_INFINITY }).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(CastError);
      expect((error as CastError).value).toBe("?");
      expect((error as CastError).message).toContain('for "?"');
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[0])).toContain("sensitive mask threw");
    } finally {
      log.mockRestore();
    }
  });

  test("CastError of a sensitive field: value and message masked", async () => {
    /* cast: a value of the wrong type on purpose — the cast of the filter must fail */
    const error = await Users.find({ age: "abc12" as unknown as number }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).value).toBe("?");
    expect((error as CastError).message).not.toContain("abc12");
  });

  test("ValidationError of a sensitive field: issue value and message masked", async () => {
    const error = await Users.create({ name: "v", code: "gamma-secret" as "alpha" }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(ValidationError);
    const issue = (error as ValidationError).issues.find((one) => one.path.join(".") === "code");
    expect(issue?.value).toBe("?");
    expect((error as ValidationError).message).not.toContain("gamma-secret");
    expect(JSON.stringify(error)).not.toContain("gamma-secret");
  });

  test('a "hide" field is "[hidden]" in CastError and ValidationError (value and message)', async () => {
    /* cast: a value of the wrong type on purpose — the cast of the filter must fail */
    const cast = await Users.find({ level: "xyz77" as unknown as number }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(cast).toBeInstanceOf(CastError);
    expect((cast as CastError).value).toBe(SENSITIVE_HIDDEN);
    expect((cast as CastError).message).not.toContain("xyz77");
    /* cast: a value outside the enum on purpose — validation must fail */
    const invalid = await Users.create({ name: "v", tier: "bronze-secret" as "gold" }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(invalid).toBeInstanceOf(ValidationError);
    const issue = (invalid as ValidationError).issues.find((one) => one.path.join(".") === "tier");
    expect(issue?.value).toBe(SENSITIVE_HIDDEN);
    expect(JSON.stringify(invalid)).not.toContain("bronze-secret");
    expect((invalid as ValidationError).message).not.toContain("bronze-secret");
  });

  test('$expr referencing a "hide" field is "[hidden]" whole, a "mask" one stays "?"', async () => {
    const events = collect({ sensitive: "show" });
    await Users.find({ $expr: (f) => fn.eq(f.internal, "x") });
    expect(startOf(events, "find").summary.filter).toMatchObject({ $expr: SENSITIVE_HIDDEN });
    await Users.find({ $expr: (f) => fn.eq(f.password, "x") });
    const last = events.filter((event) => event.type === "operation.start").at(-1) as OperationStartEvent;
    expect(last.summary.filter).toMatchObject({ $expr: "?" });
  });

  test('a "hide" field update is { $set: { internal: "[hidden]" } }', async () => {
    const events = collect({ sensitive: "show" });
    await Users.updateOne({ name: "nobody" }, { $set: { internal: "x", name: "n" } });
    const update = startOf(events, "updateOne").summary.update as Record<string, Record<string, unknown>>;
    expect(update.$set?.internal).toBe(SENSITIVE_HIDDEN);
    expect(update.$set?.name).toBe("n");
  });
});

describe("operation.start before operation.error on early failures", () => {
  const order = (events: readonly InstrumentationEvent[]): string[] =>
    events.filter((event) => event.type.startsWith("operation.") && event.type !== "operation.step").map((e) => e.type);

  test("create with an invalid document, insertOne with a validation error", async () => {
    const events = collect();
    await Users.create({ name: "v", code: "nope" as "alpha" }).catch(() => undefined);
    await Users.insertOne({ name: "v", code: "nope" as "alpha" }).catch(() => undefined);
    const types = order(events);
    expect(types.filter((type) => type === "operation.error")).toHaveLength(2);
    expect(types).toEqual(["operation.start", "operation.error", "operation.start", "operation.error"]);
  });

  test("a CastError of building the document in create() is an operation too (start + error at cast)", async () => {
    const events = collect();
    /* cast: values of the wrong type on purpose — building the document must fail with a CastError */
    const one = await Users.create({ name: "c", age: "abc" as unknown as number }).catch((error: unknown) => error);
    /* cast: the same wrong type in an array input */
    const many = await Users.create([{ name: "c", age: "x1" as unknown as number }]).catch((error: unknown) => error);
    expect(one).toBeInstanceOf(CastError);
    expect(many).toBeInstanceOf(CastError);
    expect(order(events)).toEqual(["operation.start", "operation.error", "operation.start", "operation.error"]);
    const errors = events.filter((event) => event.type === "operation.error");
    expect(errors.map((event) => (event as { failedStep?: string }).failedStep)).toEqual(["cast", "cast"]);
    expect(await Users.countDocuments({ name: "c" })).toBe(0);
  });

  test("no operation.step event precedes operation.start (validation failure and a normal write)", async () => {
    const events = collect();
    /* A validation failure inside the `validate` step (an insert validates in the document's preparation). */
    await Users.updateOne({ name: "v" }, { $set: { code: "nope" as "alpha" } }).catch(() => undefined);
    await Users.insertOne({ name: "ok" });
    await Users.find({ name: "ok" });
    const byOperation = new Map<unknown, string[]>();
    for (const event of events) {
      if (!event.type.startsWith("operation.")) continue;
      const id = (event as { operationId?: unknown }).operationId;
      const list = byOperation.get(id) ?? [];
      list.push(event.type);
      byOperation.set(id, list);
    }
    expect(byOperation.size).toBe(3);
    for (const list of byOperation.values()) {
      expect(list[0]).toBe("operation.start");
      expect(list.some((type) => type === "operation.step")).toBe(true);
    }
  });
});

describe("transaction.* events carry a masked error", () => {
  const abortOf = (events: readonly InstrumentationEvent[]): TransactionEvent => {
    const found = events.find((event): event is TransactionEvent => event.type === "transaction.abort");
    if (found === undefined) throw new Error("no transaction.abort");
    return found;
  };
  const textOf = (error: unknown): string =>
    error instanceof Error
      ? `${error.message} ${JSON.stringify(error)} ${JSON.stringify((error as { keyValue?: unknown }).keyValue)}`
      : JSON.stringify(error);

  test('by the failing operation\'s schema: unmarked shown only to "show", marked never', async () => {
    const Txs = t.connection.model(STx);
    await Txs.createIndexes();
    await Txs.create({ handle: "h-taken", secret: "s-taken" });
    const run = async (row: { handle?: string; secret?: string }) => {
      const masked = collect();
      const shown = collect({ sensitive: "show" });
      await t.connection
        .transaction(async () => {
          await Txs.create(row);
        })
        .catch(() => undefined);
      return { masked: abortOf(masked).error, shown: abortOf(shown).error };
    };
    const unmarked = await run({ handle: "h-taken", secret: "s-free" });
    expect((unmarked.masked as Error).name).toBe("DuplicateKeyError");
    expect(textOf(unmarked.masked)).not.toContain("h-taken");
    expect(textOf(unmarked.shown)).toContain("h-taken");
    const marked = await run({ handle: "h-free", secret: "s-taken" });
    expect(textOf(marked.masked)).not.toContain("s-taken");
    expect(textOf(marked.shown)).not.toContain("s-taken");
  });

  test('without an operation (a raw driver error): never shown raw, even to "show"', () => {
    const raw = Object.assign(
      new Error('E11000 duplicate key error collection: db.c index: k_1 dup key: { k: "raw-v" }'),
      {
        name: "MongoServerError",
        code: 11000,
        keyValue: { k: "raw-v" },
      },
    );
    for (const mode of ["show", "mask"] as const) {
      const masked = SensitiveMask.transaction(raw, mode);
      expect(textOf(masked)).not.toContain("raw-v");
    }
    expect(SensitiveMask.transaction(undefined, "show")).toBeUndefined();
    /* The application's own error carries no server text: as operation.error, it is passed on. */
    const own = new Error("mine");
    expect(SensitiveMask.transaction(own, "mask") as unknown).toBe(own);
  });
});

describe("mask failures outside emit reach the subscribers", () => {
  const castFailure = async (): Promise<unknown> =>
    t.connection
      .model(SThrowCast)
      /* A number that fails the cast (not finite): the mask is called for it and throws. */
      .find({ n: Number.POSITIVE_INFINITY })
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );

  test("(c) cast step: CastError shows ?, one instrumentation.error (model, path, no value), no console", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const events = collect();
      const error = await castFailure();
      expect(error).toBeInstanceOf(CastError);
      expect((error as CastError).value).toBe("?");
      const failures = failuresOf(events);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.model).toBe("SThrowCast");
      expect(failures[0]?.path).toBe("n");
      expect(JSON.stringify({ ...failures[0], error: String(failures[0]?.error) })).not.toContain("Infinity");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("(b) masked error before emit: a duplicate key on a throwing field is an instrumentation.error", async () => {
    const Dups = t.connection.model(SThrowDup);
    await Dups.createIndexes();
    await Dups.create({ key: "k-taken-secret" });
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const events = collect();
      await Dups.create({ key: "k-taken-secret" }).catch(() => undefined);
      expect(events.some((event) => event.type === "operation.error")).toBe(true);
      const failures = failuresOf(events);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.model).toBe("SThrowDup");
      expect(failures[0]?.path).toBe("key");
      expect(JSON.stringify({ ...failures[0], error: String(failures[0]?.error) })).not.toContain("k-taken");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("(b) transaction.abort masked before emit: its failure is an instrumentation.error too", async () => {
    const Dups = t.connection.model(SThrowDup);
    await Dups.createIndexes();
    await Dups.create({ key: "k-tx-secret" }).catch(() => undefined);
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const events = collect();
      await t.connection
        .transaction(async () => {
          await Dups.create({ key: "k-tx-secret" });
        })
        .catch(() => undefined);
      const abort = events.findIndex((event) => event.type === "transaction.abort");
      expect(abort).toBeGreaterThan(-1);
      const failures = failuresOf(events);
      /* One for the operation (its model), one while the abort event's error was masked (no operation: no model). */
      expect(failures.map((failure) => [failure.model, failure.path])).toEqual([
        ["SThrowDup", "key"],
        [undefined, "key"],
      ]);
      expect(JSON.stringify(failures.map((failure) => String(failure.error)))).not.toContain("k-tx");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("(b) without subscribers: console.error once", async () => {
    const Dups = t.connection.model(SThrowDup);
    await Dups.createIndexes();
    await Dups.create({ key: "k-once" }).catch(() => undefined);
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      await Dups.create({ key: "k-once" }).catch(() => undefined);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[0])).toContain("sensitive mask threw");
    } finally {
      log.mockRestore();
    }
  });
});

describe("driver command masking keeps the command name and its collection", () => {
  /* The `update` command's first key is the collection; `update` of findAndModify is the update document (data). */
  test("every write and read command: the first key is kept, the data keys are masked", () => {
    const commands: Record<string, Record<string, unknown>> = {
      find: { find: "users", filter: { name: "ann" }, projection: { name: 1 } },
      insert: { insert: "users", documents: [{ name: "ann" }] },
      update: { update: "users", updates: [{ q: { name: "ann" }, u: { $set: { name: "bob" } } }] },
      delete: { delete: "users", deletes: [{ q: { name: "ann" }, limit: 1 }] },
      findAndModify: { findAndModify: "users", query: { name: "ann" }, update: { $set: { name: "bob" } } },
      aggregate: { aggregate: "users", pipeline: [{ $match: { name: "ann" } }], cursor: {} },
      count: { count: "users", query: { name: "ann" } },
      distinct: { distinct: "users", key: "name", query: { name: "ann" } },
      explain: { explain: { update: "users", updates: [{ q: { name: "ann" }, u: { name: "bob" } }] } },
    };
    for (const [name, command] of Object.entries(commands)) {
      const masked = SensitiveMask.command(undefined, command, "mask") as Record<string, unknown>;
      const text = JSON.stringify(masked);
      if (name === "explain") expect((masked.explain as Record<string, unknown>).update).toBe("users");
      else expect(masked[name]).toBe("users");
      expect(text).not.toContain("ann");
      expect(text).not.toContain("bob");
    }
  });
});

describe("a mask function sees only a value of the field's declared type", () => {
  /** Every value the mask functions of `STyped` were called with. */
  const seen: unknown[] = [];

  /** Typed mask functions that would throw on a value of another type (`slice` of a number, `join` of a string). */
  @Schema({ collection: "s66_typed" })
  class STyped extends Entity {
    @Prop(() => String, {
      maxLength: 8,
      sensitive: {
        mask: (value: string) => {
          seen.push(value);
          return `…${value.slice(-2)}`;
        },
      },
    })
    card?: string;

    @Prop(() => [String], {
      sensitive: {
        mask: (value: string[]) => {
          seen.push(value);
          return value.join("+").length;
        },
      },
    })
    codes!: string[];
  }

  beforeEach(() => {
    seen.length = 0;
  });

  test('a CastError of a value of another type is "?" without calling the mask', async () => {
    const Typed = t.connection.model(STyped);
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      /* cast: a number for a string field on purpose — the cast must fail */
      const error = await Typed.create({ card: 4242 as unknown as string }).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(CastError);
      expect((error as CastError).value).toBe("?");
      expect(seen).toEqual([]);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("a ValidationError of a value of the declared type calls the mask", async () => {
    const Typed = t.connection.model(STyped);
    const error = await Typed.create({ card: "4242424242" }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues[0]?.value).toBe("…42");
    expect(seen).toEqual(["4242424242"]);
  });

  test("events: an array field's mask gets the whole array, never one element of a filter", async () => {
    const Typed = t.connection.model(STyped);
    const events = collect({ sensitive: "show" });
    await Typed.find({ codes: "a1", card: { $in: ["1234", "5678"] } });
    const filter = startOf(events, "find").summary.filter as Record<string, unknown>;
    expect(filter.codes).toBe("?");
    expect(filter.card).toEqual({ $in: ["…34", "…78"] });
    await Typed.updateOne({ card: "1234" }, { $set: { codes: ["a", "bc"] } });
    const update = startOf(events, "updateOne").summary.update as Record<string, Record<string, unknown>>;
    expect(update.$set?.codes).toBe(4);
    expect(seen).toContainEqual(["a", "bc"]);
    expect(seen).not.toContain("a1");
  });
});
