// Runtime tests of `@venloc/typemo-sentry` on the real server: breadcrumbs (name, data, no
// values), captured errors for several error classes, context and tags, no duplicate capture, redaction,
// `includeTenant`, `unsubscribe`.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type AggregatePlan,
  CastError,
  type Model,
  Pipeline,
  ServerError,
  type Subscription,
  Typemo,
  ValidationError,
} from "@venloc/typemo";
import { FailPointHelpers } from "@venloc/typemo-test-kit";
import { type SentryInstrumentationOptions, TypemoSentry } from "../../src/index.ts";
import { Item, SecretItem, TenantItem } from "../fixtures/sentry-entities.ts";
import { setUpTestSentry, type TestSentry } from "../support/test-sentry.ts";
import { TypemoLifecycle } from "../support/typemo-lifecycle.ts";

const t = TypemoLifecycle.useTypemo("sentry_adapter");
let Items: Model<Item>;
let sentry: TestSentry;
let subscriptions: Subscription[] = [];

/** Registers a `TypemoSentry` subscription and tracks it, so `afterEach` always unsubscribes it — a
 * leftover subscriber from one test would otherwise keep observing (and capturing) the next test's
 * operations, since `t.client` (and its instrumentation hub) is shared for the whole file. */
const instrument = (target: typeof t.client | typeof Typemo = t.client, options?: SentryInstrumentationOptions) => {
  const subscription = TypemoSentry.instrument(target, options);
  subscriptions.push(subscription);
  return subscription;
};

beforeEach(async () => {
  Items = t.connection.model(Item);
  await Items.createIndexes();
  sentry = setUpTestSentry();
});

afterEach(() => {
  for (const subscription of subscriptions) subscription.unsubscribe();
  subscriptions = [];
});

describe("breadcrumbs", () => {
  test("one per successful operation, plain-language message, redacted data, no values", async () => {
    instrument();
    await Items.create({ slug: "alpha", score: 1 });
    await Items.find({ slug: "alpha" });

    const crumbs = sentry.captured.breadcrumbs.filter((b) => b.category === "typemo");
    expect(crumbs.map((b) => b.message)).toEqual(["Typemo.insertOne (Item)", "Typemo.find (Item)"]);
    for (const crumb of crumbs) {
      expect(crumb.level).toBe("info");
      expect(crumb.data?.model).toBe("Item");
      expect(crumb.data?.collection).toBe("sentry_items");
      expect(typeof crumb.data?.durationMS).toBe("number");
    }
    const findCrumb = crumbs[1];
    /* The filter's shape is there, but "alpha" itself never is (the field is marked sensitive). */
    expect(JSON.stringify(findCrumb?.data?.summary)).not.toContain("alpha");
    expect(JSON.stringify(findCrumb?.data?.summary)).toContain("?");
  });

  test("breadcrumbs: false — no breadcrumbs, errors still captured", async () => {
    instrument(t.client, { breadcrumbs: false });
    await Items.insertOne({ slug: "" } as never).catch(() => undefined);
    await sentry.flush();
    expect(sentry.captured.breadcrumbs.filter((b) => b.category === "typemo")).toEqual([]);
    expect(sentry.captured.events.length).toBeGreaterThan(0);
  });
});

describe("captured errors", () => {
  /*
   * `insertOne`/`insertMany` cast and validate as pipeline steps; `create()`/`$save()` validate inside their
   * operation too (the last test of this block).
   */
  test("a ValidationError: captured with typemo context and tags", async () => {
    instrument();
    const error = await Items.insertOne({ slug: "" } as never).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    const event = sentry.captured.events.at(0);
    expect(event?.tags?.["typemo.error_class"]).toBe("ValidationError");
    expect(event?.tags?.["typemo.classification"]).toBe("validation");
    expect(event?.tags?.["typemo.model"]).toBe("Item");
    expect(event?.tags?.["typemo.operation"]).toBe("insertOne");
    const context = event?.contexts?.typemo as Record<string, unknown> | undefined;
    expect(context?.model).toBe("Item");
    expect(context?.collection).toBe("sentry_items");
    expect(context?.classification).toBe("validation");
  });

  test("a CastError: captured", async () => {
    instrument();
    const error = await Items.insertOne({ slug: "castme", score: "not-a-number" } as never).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CastError);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    expect(sentry.captured.events[0]?.tags?.["typemo.error_class"]).toBe("CastError");
  });

  test("a DuplicateKeyError (server error): captured", async () => {
    instrument();
    await Items.create({ slug: "dupe" });
    const error = await Items.create({ slug: "dupe" }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeDefined();
    await sentry.flush();
    const events = sentry.captured.events.filter((event) => event.tags?.["typemo.error_class"] === "DuplicateKeyError");
    expect(events).toHaveLength(1);
    const context = events[0]?.contexts?.typemo as Record<string, unknown> | undefined;
    expect(typeof context?.serverCode).toBe("number");
  });

  test('a DuplicateKeyError on a "hide" field never carries the value into the captured event', async () => {
    const Secrets = t.connection.model(SecretItem);
    await Secrets.createIndexes();
    await Secrets.create({ token: "sentry-dup-s3cr3t" });
    instrument();
    const error = await Secrets.create({ token: "sentry-dup-s3cr3t" }).catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toContain("sentry-dup-s3cr3t");
    await sentry.flush();
    const events = sentry.captured.events.filter((event) => event.tags?.["typemo.error_class"] === "DuplicateKeyError");
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).toContain("[hidden]");
    expect(JSON.stringify(sentry.captured)).not.toContain("sentry-dup-s3cr3t");
  });

  test('an unmarked value in a CastError is "?" in the captured event (default "mask")', async () => {
    instrument();
    /* cast: a wrong type on purpose (the cast must fail at run time) */
    const error = await Items.find({ score: "unmarked-sentry-value" as never }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).value).toBe("unmarked-sentry-value");
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    expect(JSON.stringify(sentry.captured)).not.toContain("unmarked-sentry-value");
  });

  test("captureErrors: false — no captured errors, breadcrumbs still there", async () => {
    instrument(t.client, { captureErrors: false });
    await Items.insertOne({ slug: "" } as never).catch(() => undefined);
    await sentry.flush();
    expect(sentry.captured.events).toEqual([]);
    expect(sentry.captured.breadcrumbs.some((b) => b.category === "typemo" && b.level === "error")).toBe(true);
  });

  test("one error, one event: two subscriptions on the same failure do not duplicate", async () => {
    instrument();
    instrument();
    await Items.insertOne({ slug: "" } as never).catch(() => undefined);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
  });
});

describe("document writes", () => {
  test("Model.create with an invalid value: the ValidationError is captured (insertOne, Item)", async () => {
    instrument();
    const error = await Items.create({ slug: "" }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    const event = sentry.captured.events.at(0);
    expect(event?.tags?.["typemo.error_class"]).toBe("ValidationError");
    expect(event?.tags?.["typemo.operation"]).toBe("insertOne");
    expect(event?.tags?.["typemo.model"]).toBe("Item");
    const crumb = sentry.captured.breadcrumbs.find((b) => b.category === "typemo" && b.level === "error");
    expect(crumb?.message).toBe("Typemo.insertOne (Item)");
    expect(crumb?.data?.failedStep).toBe("validate");
  });
});

describe("transactions", () => {
  test("a retried transaction leaves a `Typemo.transaction retry` breadcrumb, an aborted one `abort`", async () => {
    instrument();
    const failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["insert"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    try {
      let attempts = 0;
      await t.connection.transaction(async () => {
        attempts++;
        await Items.create({ slug: `tx-retry-${attempts}` });
      });
      expect(attempts).toBe(2);
    } finally {
      await failpoint.disable();
    }
    const failure = await t.connection
      .transaction(async () => {
        await Items.create({ slug: "tx-abort" });
        throw new Error("user abort");
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(failure).toBeInstanceOf(Error);
    const crumbs = sentry.captured.breadcrumbs.filter((b) => b.message?.startsWith("Typemo.transaction"));
    expect(crumbs.map((b) => [b.message, b.category, b.level])).toEqual([
      ["Typemo.transaction retry", "typemo", "warning"],
      ["Typemo.transaction abort", "typemo", "error"],
    ]);
    expect(crumbs[0]?.data?.attempt).toBe(1);
    expect(typeof crumbs[0]?.data?.transactionId).toBe("number");
    expect(crumbs[1]?.data?.errorClass).toBe("Error");
    expect(JSON.stringify(crumbs)).not.toContain("user abort");
  });

  test("breadcrumbs: false — no transaction breadcrumbs either", async () => {
    instrument(t.client, { breadcrumbs: false });
    await t.connection
      .transaction(async () => {
        throw new Error("abort");
      })
      .catch(() => undefined);
    expect(sentry.captured.breadcrumbs.filter((b) => b.message?.startsWith("Typemo.transaction"))).toEqual([]);
  });
});

describe("redaction", () => {
  test("sensitive: none — the real filter values appear in the breadcrumb", async () => {
    instrument(t.client, { sensitive: "show" });
    await Items.create({ slug: "visible" });
    await Items.find({ slug: "visible" });
    const crumb = sentry.captured.breadcrumbs.find((b) => b.message === "Typemo.find (Item)");
    expect(JSON.stringify(crumb?.data?.summary)).toContain("visible");
  });
});

describe("sensitive per field mode × subscriber mode (A2)", () => {
  const FILTER = { slug: "slug-x", pin: "pin-secret", internal: "int-x", email: "eve@x.test", city: "Oslo" };
  const crumbText = async (): Promise<string> => {
    await Items.find(FILTER);
    const crumb = sentry.captured.breadcrumbs.find((b) => b.message === "Typemo.find (Item)");
    return JSON.stringify(crumb?.data?.summary);
  };

  test('"mask" (default): unmarked "?", mask "?", hide "[hidden]", fn its result, show real', async () => {
    instrument();
    const text = await crumbText();
    expect(text).not.toContain("slug-x");
    expect(text).not.toContain("pin-secret");
    expect(text).not.toContain("int-x");
    /* A "hide" field keeps its key, the value is the marker. */
    expect(text).toContain('"internal":"[hidden]"');
    expect(text).toContain('"ev***"');
    expect(text).toContain('"Oslo"');
  });

  test('"hide": unmarked values "[hidden]"; "show": unmarked real, marks kept', async () => {
    const hidden = instrument(t.client, { sensitive: "hide" });
    let text = await crumbText();
    expect(text).not.toContain("slug-x");
    expect(text).toContain('"slug":"[hidden]"');
    expect(text).not.toContain("pin-secret");
    expect(text).toContain('"ev***"');
    expect(text).toContain('"Oslo"');
    hidden.unsubscribe();
    sentry.reset();
    instrument(t.client, { sensitive: "show" });
    text = await crumbText();
    expect(text).toContain("slug-x");
    expect(text).not.toContain("pin-secret");
    expect(text).not.toContain("int-x");
    expect(text).toContain('"ev***"');
  });

  test("a subscriber function (value, { path }); the captured event never carries a marked value", async () => {
    instrument(t.client, { sensitive: { mask: (value, { path }) => `${path}#${String(value).length}` } });
    const text = await crumbText();
    expect(text).toContain('"slug#6"');
    expect(text).not.toContain("pin-secret");
    expect(text).toContain('"ev***"');
    const error = await Items.insertOne({ slug: "p", pin: "ab" }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    expect(JSON.stringify(sentry.captured.events[0])).not.toContain('"ab"');
  });

  test("a throwing subscriber mask is captured as an instrumentation error, without the value", async () => {
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      instrument(t.client, {
        sensitive: {
          mask: (value) => {
            throw new Error(`bad ${String(value)}`);
          },
        },
      });
      await Items.find({ slug: "mask-s3cr3t" });
    } finally {
      console.error = original;
    }
    await sentry.flush();
    const captured = sentry.captured.events.filter(
      (event) => event.tags?.["typemo.instrumentation.source"] === "sensitive-mask",
    );
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]?.tags?.["typemo.model"]).toBe("Item");
    expect((captured[0]?.contexts?.typemo as Record<string, unknown> | undefined)?.path).toBe("slug");
    expect(JSON.stringify(sentry.captured.events)).not.toContain("s3cr3t");
    expect(logged).toEqual([]);
  });
});

describe("includeTenant", () => {
  test("off by default: no tenant in the captured error's context", async () => {
    instrument();
    await Items.insertOne({ slug: "" } as never).catch(() => undefined);
    await sentry.flush();
    const context = sentry.captured.events[0]?.contexts?.typemo as Record<string, unknown> | undefined;
    expect(context).not.toHaveProperty("tenant");
    expect(sentry.captured.events[0]?.tags).not.toHaveProperty("typemo.tenant");
  });

  test("off by default on a tenant model too: neither tag nor context", async () => {
    instrument();
    const TenantItems = t.connection.model(TenantItem);
    await TenantItems.find({ slug: { $bogus: 1 } } as never)
      .policy({ tenant: "t1" })
      .catch(() => undefined);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    expect(sentry.captured.events[0]?.contexts?.typemo).not.toHaveProperty("tenant");
    expect(sentry.captured.events[0]?.tags).not.toHaveProperty("typemo.tenant");
  });

  test("includeTenant: true — the tenant is the `typemo.tenant` tag and `tenant` of the error context", async () => {
    instrument(t.client, { includeTenant: true });
    const TenantItems = t.connection.model(TenantItem);
    await TenantItems.find({ slug: { $bogus: 1 } } as never)
      .policy({ tenant: "t1" })
      .catch(() => undefined);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    expect(sentry.captured.events[0]?.tags?.["typemo.tenant"]).toBe("t1");
    expect(sentry.captured.events[0]?.contexts?.typemo).toMatchObject({ tenant: "t1" });
  });

  test("includeTenant: true on a model without a tenant: no tag, no context entry", async () => {
    instrument(t.client, { includeTenant: true });
    await Items.insertOne({ slug: "" } as never).catch(() => undefined);
    await sentry.flush();
    expect(sentry.captured.events[0]?.contexts?.typemo).not.toHaveProperty("tenant");
    expect(sentry.captured.events[0]?.tags).not.toHaveProperty("typemo.tenant");
  });
});

describe("unsubscribe", () => {
  test("stops both breadcrumbs and error capture", async () => {
    const subscription = instrument();
    subscription.unsubscribe();
    subscriptions = subscriptions.filter((s) => s !== subscription);
    await Items.insertOne({ slug: "" } as never).catch(() => undefined);
    await sentry.flush();
    expect(sentry.captured.breadcrumbs.filter((b) => b.category === "typemo")).toEqual([]);
    expect(sentry.captured.events).toEqual([]);
  });
});

describe("global target (Typemo.instrument)", () => {
  test("TypemoSentry.instrument(Typemo, …) observes every client's operations", async () => {
    instrument(Typemo);
    await Items.create({ slug: "global" });
    expect(sentry.captured.breadcrumbs.some((b) => b.message === "Typemo.insertOne (Item)")).toBe(true);
  });
});

describe("database-level operations (connection.aggregate, no model)", () => {
  test("breadcrumb names the database; no model or collection in the data", async () => {
    instrument();
    await t.connection.aggregate(
      Pipeline.database()
        .documents([{ n: 1 }])
        .plan(),
    );
    const crumb = sentry.captured.breadcrumbs.find((b) => b.category === "typemo");
    expect(crumb?.message).toBe(`Typemo.aggregate (database ${t.connection.name})`);
    expect(crumb?.data?.database).toBe(t.connection.name);
    expect(crumb?.data).not.toHaveProperty("model");
    expect(crumb?.data).not.toHaveProperty("collection");
  });

  test("a captured error has no typemo.model tag; the context carries the database", async () => {
    instrument();
    const plan = Pipeline.database()
      .documents([{ n: 1 }])
      .plan();
    /* `$currentOp` runs on admin only: the server refuses it in the user's database. */
    const wrong: AggregatePlan<unknown> = { ...plan, pipeline: [{ $currentOp: {} }] };
    const caught = await t.connection.aggregate(wrong).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(ServerError);
    await sentry.flush();
    expect(sentry.captured.events).toHaveLength(1);
    const event = sentry.captured.events.at(0);
    expect(event?.tags).not.toHaveProperty("typemo.model");
    expect(event?.tags?.["typemo.operation"]).toBe("aggregate");
    const context = event?.contexts?.typemo as Record<string, unknown> | undefined;
    expect(context).not.toHaveProperty("model");
    expect(context).not.toHaveProperty("collection");
    expect(context?.database).toBe(t.connection.name);
  });
});
