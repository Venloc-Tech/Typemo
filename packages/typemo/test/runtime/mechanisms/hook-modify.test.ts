/*
 * On the real server: a pre hook changes the operation with `this.modify(change)`, and
 * every policy still holds — the changed operation goes through normalize → resolvePaths → cast → policies →
 * defaults → validate again before it is sent: a `$lookup` a hook adds is scoped by the joined model's tenant and
 * loses its hidden fields, a condition is cast and sanitized, an unknown path or an immutable one is refused, the
 * audit records the final operation. A hook that changes nothing runs no step again.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ObjectId } from "mongodb";
import { HookChanges } from "../../../src/hooks/hook-changes.ts";
import {
  ConnectionInternals,
  fn,
  type InstrumentationEvent,
  type Model,
  OperationContext,
  type OperationPipeline,
  type OperationStep,
  PolicyContext,
  QueryError,
  type StepName,
  StrictModeError,
} from "../../../src/internal.ts";
import { NormalizeStep } from "../../../src/operation/steps/normalize-step.ts";
import {
  ModAccount,
  ModCustomer,
  ModInvoice,
  ModifyPlan,
  ModLedger,
  ModTrash,
  ModUser,
} from "../../fixtures/mechanisms/hook-modify-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("r7_modify");
let Users: Model<ModUser>;
let Customers: Model<ModCustomer>;
let Invoices: Model<ModInvoice>;
let Ledger: Model<ModLedger>;
let Accounts: Model<ModAccount>;
let Trash: Model<ModTrash>;
/**
 * Runs work inside a tenant scope.
 * @param tenant The tenant id.
 * @param work The work to run.
 * @returns The result of the work.
 */
const inTenant = <R>(tenant: string, work: () => R): R => PolicyContext.run({ tenant }, work);
/**
 * The one command of `name` the last operation sent.
 * @param name The command name.
 * @returns The recorded command document.
 */
const sent = (name: string): Record<string, unknown> => {
  const commands = t.commands.byName(name);
  expect(commands.length).toBe(1);
  return commands[0]?.command as Record<string, unknown>;
};

beforeEach(async () => {
  ModifyPlan.reset();
  Users = t.connection.model(ModUser);
  Customers = t.connection.model(ModCustomer);
  Invoices = t.connection.model(ModInvoice);
  Ledger = t.connection.model(ModLedger);
  Accounts = t.connection.model(ModAccount);
  Trash = t.connection.model(ModTrash);
  t.commands.clear();
});

afterEach(() => {
  ModifyPlan.reset();
});

describe("the changed operation passes every policy again", () => {
  test("a hook adds $lookup to a tenant model: the joined model's tenant condition is inside, its hidden field removed", async () => {
    const mine = new ObjectId();
    const theirs = new ObjectId();
    await t.mongo.db.collection("hm_customers").insertMany([
      { _id: mine, tenantId: "ta", name: "own", secret: "s1" },
      { _id: theirs, tenantId: "tb", name: "other", secret: "s2" },
    ]);
    await t.mongo.db.collection("hm_invoices").insertMany([
      { tenantId: "ta", customer: mine, total: 1 },
      { tenantId: "ta", customer: theirs, total: 2 },
      { tenantId: "tb", customer: theirs, total: 3 },
    ]);
    t.commands.clear();
    ModifyPlan.next = {
      stages: [{ $lookup: { from: "hm_customers", localField: "customer", foreignField: "_id", as: "c" } }],
    };
    /* cast: the $lookup the hook adds is not in the row type of the builder (the hook changed the operation) */
    const rows = (await inTenant("ta", () => Invoices.aggregate((p) => p.sort({ total: 1 })))) as unknown as {
      total: number;
      c: Record<string, unknown>[];
    }[];
    /* Tenant ta only; the invoice of ta pointing to tb's customer joins nothing; no secret. */
    expect(rows.map((row) => [row.total, row.c.map((c) => c.name)])).toEqual([
      [1, ["own"]],
      [2, []],
    ]);
    expect(rows[0]?.c[0]?.secret).toBeUndefined();
    const pipeline = sent("aggregate").pipeline as Record<string, unknown>[];
    expect(pipeline[0]).toEqual({ $match: { tenantId: "ta" } });
    const lookup = pipeline.find((stage) => "$lookup" in stage)?.$lookup as { pipeline: unknown[] };
    expect(lookup.pipeline).toEqual([{ $match: { tenantId: "ta" } }, { $unset: ["secret"] }]);
    /* The next pre hook saw the final pipeline (database form, the policies applied). */
    expect(ModifyPlan.seen[0]?.pipeline).toEqual(pipeline);
  });

  test("a hook adds a filter condition: ANDed with the user's, cast by the schema (lowercase), next hook sees it", async () => {
    await t.mongo.db.collection("hm_users").insertMany([
      { name: "Ann", email: "ann@x.test" },
      { name: "Ann", email: "other@x.test" },
    ]);
    t.commands.clear();
    ModifyPlan.next = { where: { email: "ANN@X.TEST" } };
    const found = await Users.find({ name: "Ann" }).lean();
    expect(found.map((user) => user.email)).toEqual(["ann@x.test"]);
    expect(sent("find").filter).toEqual({ name: "Ann", email: "ann@x.test" });
    expect(ModifyPlan.seen[0]?.filter).toEqual({ name: "Ann", email: "ann@x.test" });
  });

  test("a hook adds a condition the sanitize policy refuses: StrictModeError, postError once, nothing sent", async () => {
    ModifyPlan.next = { where: { name: { $eq: { $ne: null } } } };
    const error = await Users.find({ name: "Ann" }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("sanitize");
    expect(ModifyPlan.errors).toEqual(["query.find StrictModeError"]);
    expect(ModifyPlan.seen).toEqual([]);
    expect(t.commands.byName("find")).toEqual([]);
  });

  test("a condition of another tenant never replaces the operation's tenant", async () => {
    await t.mongo.db.collection("hm_customers").insertMany([
      { tenantId: "ta", name: "x" },
      { tenantId: "tb", name: "x" },
    ]);
    t.commands.clear();
    ModifyPlan.next = { where: { tenantId: "tb" } };
    const found = await inTenant("ta", () => Customers.find({ name: "x" }).lean());
    expect(found).toEqual([]);
    expect(sent("find").filter).toEqual({ $and: [{ name: "x", tenantId: "tb" }, { tenantId: "ta" }] });
  });

  test("a hook names an unknown path (filter, projection, sort): StrictModeError unknown-path", async () => {
    for (const change of [{ where: { nope: 1 } }, { select: { nope: 1 } }, { sort: { nope: 1 } }]) {
      ModifyPlan.reset();
      ModifyPlan.next = change;
      const error = await Users.find({ name: "Ann" }).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(StrictModeError);
      expect((error as StrictModeError).reason).toBe("unknown-path");
      expect(ModifyPlan.errors).toEqual(["query.find StrictModeError"]);
    }
    expect(t.commands.byName("find")).toEqual([]);
  });

  test("a hook adds an update of an immutable field: StrictModeError immutable, nothing written", async () => {
    await t.mongo.db.collection("hm_users").insertOne({ name: "Ann", code: "c1" });
    t.commands.clear();
    ModifyPlan.next = { update: { $set: { code: "c2" } } };
    const error = await Users.updateOne({ name: "Ann" }, { $set: { age: 3 } }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("immutable");
    expect(t.commands.byName("update")).toEqual([]);
    expect(await t.mongo.db.collection("hm_users").findOne({ name: "Ann" })).toMatchObject({ code: "c1" });
  });

  test("an update merged by a hook is cast and sent with the user's; select and sort replace the find's", async () => {
    await t.mongo.db.collection("hm_users").insertMany([
      { name: "Ann", age: 1 },
      { name: "Bob", age: 2 },
    ]);
    ModifyPlan.next = { update: { $set: { email: "ANN@X.TEST" } } };
    await Users.updateOne({ name: "Ann" }, { $set: { age: 5 } });
    expect(await t.mongo.db.collection("hm_users").findOne({ name: "Ann" })).toMatchObject({
      age: 5,
      email: "ann@x.test",
    });
    ModifyPlan.next = { select: { name: 1 }, sort: { age: -1 } };
    t.commands.clear();
    const found = await Users.find({ age: { $gte: 1 } }).lean();
    expect(found.map((user) => Object.keys(user).sort())).toEqual([
      ["_id", "name"],
      ["_id", "name"],
    ]);
    expect(found.map((user) => user.name)).toEqual(["Ann", "Bob"]); /* Ann is 5 now, Bob 2 */
    const command = sent("find");
    expect(command.projection).toEqual({ name: 1 });
    expect([...(command.sort as Map<string, number>)]).toEqual([["age", -1]]); /* the driver sends a sort as a Map */
  });

  test("the audit records the final operation", async () => {
    await t.mongo.db.collection("hm_ledger").insertOne({ name: "a", n: 0 });
    ModifyPlan.next = { update: { $set: { note: "by-hook" } } };
    await Ledger.updateOne({ name: "a" }, { $set: { n: 1 } });
    const entry = await t.mongo.db.collection("hm_ledger_audit").findOne({ operation: "updateOne" });
    expect(entry?.update).toEqual({ $set: { n: 1, note: "by-hook" } });
    expect(await t.mongo.db.collection("hm_ledger").findOne({ name: "a" })).toMatchObject({ n: 1, note: "by-hook" });
  });
});

describe("the modify API is checked", () => {
  test("a change that does not apply to the operation, an unknown change, a path written twice: QueryError", async () => {
    const cases: readonly [unknown, () => Promise<unknown>, RegExp][] = [
      [{ stages: [] }, () => Users.find({ name: "a" }).exec(), /"stages" does not apply to find/],
      [{ update: { $set: { age: 1 } } }, () => Users.find({ name: "a" }).exec(), /"update" does not apply to find/],
      [{ where: { name: "a" } }, () => Users.insertMany([{ name: "b" }]), /"where" does not apply to insertMany/],
      [{ limit: 1 }, () => Users.find({ name: "a" }).exec(), /unknown change "limit"/],
      [
        { update: { $set: { age: 2 } } },
        () => Users.updateOne({ name: "a" }, { $set: { age: 1 } }).exec(),
        /"\$set.age" is already written/,
      ],
    ];
    for (const [change, run, message] of cases) {
      ModifyPlan.reset();
      ModifyPlan.next = change;
      const error = await run().catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(QueryError);
      expect((error as QueryError).message).toMatch(message);
    }
  });

  test("a hook that changes nothing runs no step again and copies nothing (perf guard)", async () => {
    const normalize = spyOn(NormalizeStep.prototype, "run");
    const initial = spyOn(HookChanges, "initial");
    try {
      await Users.find({ name: "a" });
      await Users.countDocuments({ name: "a" });
      await Users.updateOne({ name: "a" }, { $set: { age: 1 } });
      expect(normalize).toHaveBeenCalledTimes(3);
      expect(initial).not.toHaveBeenCalled();
      ModifyPlan.next = { where: { age: 1 } };
      await Users.find({ name: "a" });
      /* Once for the operation, once again after the hook's change. */
      expect(normalize).toHaveBeenCalledTimes(5);
      expect(initial).toHaveBeenCalledTimes(1);
    } finally {
      normalize.mockRestore();
      initial.mockRestore();
    }
  });
});

describe("modify on more operations (dbName + tenant, soft delete, cursor, explain)", () => {
  /**
   * The raw accounts collection.
   * @returns The driver collection.
   */
  const accounts = () => t.mongo.db.collection("hm_accounts");
  /**
   * The stored accounts without their `_id`.
   * @returns The raw documents.
   */
  const stored = async (): Promise<Record<string, unknown>[]> =>
    (
      await accounts()
        .find({}, { projection: { _id: 0 } })
        .toArray()
    )
      .map((row): Record<string, unknown> => ({ ...row }))
      .sort((a, b) => String(a.n).localeCompare(String(b.n)));

  test("#3: modify({}) in bulkWrite, insertMany and find hooks changes nothing — no step runs again, the operation is right", async () => {
    await accounts().insertOne({ tenantId: "ta", n: "a", q: 1 });
    t.commands.clear();
    ModifyPlan.next = {};
    const normalize = spyOn(NormalizeStep.prototype, "run");
    try {
      await inTenant("ta", () =>
        Accounts.bulkWrite([
          { updateOne: { filter: { name: "a" }, update: { $set: { qty: 2 } } } },
          { insertOne: { document: { name: "b" } } },
        ]),
      );
      await inTenant("ta", () => Accounts.insertMany([{ name: "c", qty: 3 }]));
      const found = await inTenant("ta", () => Accounts.find({ name: "a" }).lean());
      expect(found.map((row) => row.qty)).toEqual([2]);
      expect(normalize).toHaveBeenCalledTimes(3);
    } finally {
      normalize.mockRestore();
    }
    expect(ModifyPlan.errors).toEqual([]);
    expect(await stored()).toEqual([
      { tenantId: "ta", n: "a", q: 2 },
      { tenantId: "ta", n: "b" },
      { tenantId: "ta", n: "c", q: 3 },
    ]);
    /* The next hook saw the operations in database form, once each: the bulk's updateOne runs its own
       query.updateOne hooks first (that one operation), then the bulk's hooks see the list. */
    expect(ModifyPlan.seen.length).toBe(4);
    expect(ModifyPlan.seen[0]).toMatchObject({
      filter: { n: "a", tenantId: "ta" },
      update: { $set: { q: 2 } },
      operations: undefined,
    });
    expect(ModifyPlan.seen[1]?.operations).toEqual([
      { updateOne: { filter: { n: "a", tenantId: "ta" }, update: { $set: { q: 2 } } } },
      { insertOne: { document: { _id: expect.any(ObjectId), n: "b", tenantId: "ta" } } },
    ]);
  });

  test("#4: an update with an own `__proto__` key from a hook is a QueryError, never a silent success", async () => {
    await t.mongo.db.collection("hm_users").insertOne({ name: "Ann", age: 1 });
    t.commands.clear();
    ModifyPlan.next = { update: JSON.parse('{"__proto__":{"age":5}}') };
    const error = await Users.updateOne({ name: "Ann" }, { $set: { note: "x" } }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(QueryError);
    expect(t.commands.byName("update")).toEqual([]);
    expect(await t.mongo.db.collection("hm_users").findOne({ name: "Ann" })).toMatchObject({ age: 1 });
    /* Thrown at the hook's call: the pre hook failed, so the operation ends in its postError once. */
    expect(ModifyPlan.errors).toEqual(["query.updateOne QueryError"]);
  });

  test("soft delete: a delete narrowed by a hook is still the soft-delete update, of the narrowed filter", async () => {
    await t.mongo.db.collection("hm_trash").insertMany([
      { n: "x", deletedAt: null },
      { n: "y", deletedAt: null },
    ]);
    t.commands.clear();
    ModifyPlan.next = { where: { name: "x" } };
    const result = await Trash.deleteMany({ name: { $in: ["x", "y"] } });
    expect(result.deletedCount).toBe(1);
    expect(t.commands.byName("delete")).toEqual([]);
    const update = sent("update") as { updates: { q: unknown }[] };
    expect(update.updates[0]?.q).toEqual({ $and: [{ n: { $in: ["x", "y"] } }, { n: "x" }], deletedAt: null });
    const rows = await t.mongo.db.collection("hm_trash").find({}).sort({ n: 1 }).toArray();
    expect(rows.map((row) => [row.n, row.deletedAt instanceof Date])).toEqual([
      ["x", true],
      ["y", false],
    ]);
  });

  test("a cursor: the hook's condition, with the tenant, in the one find sent", async () => {
    await accounts().insertMany([
      { tenantId: "ta", n: "a" },
      { tenantId: "ta", n: "b" },
      { tenantId: "tb", n: "a" },
    ]);
    t.commands.clear();
    ModifyPlan.next = { where: { name: "a" } };
    const names = await inTenant("ta", async () => {
      const out: string[] = [];
      for await (const doc of Accounts.find({}).cursor()) out.push(`${doc.tenantId}/${doc.name}`);
      return out;
    });
    expect(names).toEqual(["ta/a"]);
    expect(sent("find").filter).toEqual({ n: "a", tenantId: "ta" });
    expect(ModifyPlan.seen.map((seen) => seen.filter)).toEqual([{ n: "a", tenantId: "ta" }]);
  });

  test("explain: the plan explained is the changed operation (the hook's condition, the tenant)", async () => {
    ModifyPlan.next = { where: { name: "a" } };
    const plan = (await inTenant("ta", () => Accounts.find({ qty: 1 }).explain())) as {
      command?: { filter?: unknown };
    };
    expect(plan.command?.filter).toEqual({ q: 1, n: "a", tenantId: "ta" });
  });

  test("#10: this.pipeline / this.update read twice are the same frozen view; after a change, a new one", async () => {
    await t.mongo.db.collection("hm_invoices").insertOne({ tenantId: "ta", customer: new ObjectId(), total: 1 });
    ModifyPlan.next = { stages: [{ $limit: 1 }] };
    await inTenant("ta", () => Invoices.aggregate((p) => p.sort({ total: 1 })));
    const seen = ModifyPlan.seen[0];
    expect(seen?.stable).toBe(true);
    expect(Object.isFrozen(seen?.pipeline)).toBe(true);
    /* The view the first hook read before its change is not the view of the changed pipeline. */
    expect(ModifyPlan.viewBefore).not.toBe(seen?.pipeline);
    const after = (seen?.pipeline ?? []) as readonly unknown[];
    const before = (ModifyPlan.viewBefore ?? []) as readonly unknown[];
    expect(after.length).toBe(before.length + 1);
    ModifyPlan.reset();
    await inTenant("ta", () => Accounts.updateOne({ name: "a" }, (p) => p.set(() => ({ qty: fn.literal(1) }))));
    expect(ModifyPlan.seen[0]?.stable).toBe(true);
    expect(Array.isArray(ModifyPlan.seen[0]?.update)).toBe(true);
    expect(Object.isFrozen(ModifyPlan.seen[0]?.update)).toBe(true);
  });
});

describe("after a hook's change the steps run again from the WHOLE state before them", () => {
  let original: OperationPipeline | undefined;
  afterEach(() => {
    if (original !== undefined) ConnectionInternals.usePipeline(t.connection, original);
    original = undefined;
  });

  /**
   * Whether a step returned a promise.
   * @param value The step's return value.
   * @returns True for a thenable.
   */
  const isPromise = (value: unknown): value is Promise<void> =>
    typeof value === "object" && value !== null && typeof (value as Promise<void>).then === "function";

  /**
   * The standard step of `slot` with `before`/`after` around its `run` (its `onError` kept).
   * @param slot The pipeline slot to wrap.
   * @param before Called before the standard `run`.
   * @param after Called after the standard `run`.
   * @returns The wrapping step.
   */
  const around = (
    slot: StepName,
    before: (ctx: OperationContext) => void,
    after: (ctx: OperationContext) => void,
  ): OperationStep => {
    original ??= ConnectionInternals.pipeline(t.connection);
    const real = original.step(slot);
    const onError = real.onError;
    return {
      name: real.name,
      run: (ctx: OperationContext): void | Promise<void> => {
        before(ctx);
        const out = real.run(ctx);
        if (isPromise(out)) return out.then(() => after(ctx));
        after(ctx);
      },
      ...(onError === undefined ? {} : { onError: (ctx: OperationContext) => onError.call(real, ctx) }),
    };
  };
  /**
   * Replaces steps of the connection's pipeline.
   * @param steps The steps to use, by slot.
   */
  const use = (steps: Partial<Record<StepName, OperationStep>>): void => {
    original ??= ConnectionInternals.pipeline(t.connection);
    ConnectionInternals.usePipeline(t.connection, original.with(steps));
  };
  /** A step callback that does nothing. */
  const none = (): void => undefined;

  test("a value step's conditional local (set on the first run only) is gone after the change: no stale state", async () => {
    /* A value step of the future that writes `locals` only in some cases: `restore` must not need to know it. */
    const PROBE = Symbol("test.conditional");
    const atSend: boolean[] = [];
    use({
      defaults: around("defaults", none, (ctx) => {
        const filter = (ctx.filter ?? {}) as Record<string, unknown>;
        if (!("email" in filter)) ctx.locals.set(PROBE, true);
      }),
      instrumentStart: around("instrumentStart", (ctx) => atSend.push(ctx.locals.has(PROBE)), none),
    });
    await Users.find({ name: "a" }); /* no change: the probe stays (the step ran once, without the condition) */
    ModifyPlan.next = { where: { email: "a@x.test" } };
    await Users.find({ name: "a" }); /* the change adds the condition: the second run does not set the probe */
    expect(atSend).toEqual([true, false]);
  });

  test("the changed operation reaches the driver in exactly the state of the same operation built without a hook", async () => {
    const states: unknown[] = [];
    /**
     * The sorted descriptions of the working locals of an operation.
     * @param ctx The operation context.
     * @returns The local keys' descriptions.
     */
    const describeLocals = (ctx: OperationContext) =>
      [...ctx.locals.keys()].map((key) => key.description ?? "?").sort((a, b) => a.localeCompare(b));
    /**
     * Two operations have two clocks: a `Date` compares as "a date" (the rest exactly).
     * @param value The value to normalize.
     * @returns The value with every date replaced by a marker.
     */
    const timeless = (value: unknown): unknown =>
      value instanceof Date
        ? "<date>"
        : Array.isArray(value)
          ? value.map(timeless)
          : typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
            ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timeless(item)]))
            : value;
    use({
      instrumentStart: around(
        "instrumentStart",
        (ctx) => {
          const values: Record<string, unknown> = {};
          for (const field of OperationContext.VALUE_FIELDS) values[field] = timeless(ctx[field]);
          states.push({ values, locals: describeLocals(ctx), rejected: ctx.rejected });
        },
        none,
      ),
    });
    const cases: readonly [unknown, () => Promise<unknown>, () => Promise<unknown>][] = [
      [
        { where: { email: "ANN@X.TEST" } },
        () => Users.find({ name: "Ann" }).exec(),
        () => Users.find({ name: "Ann", email: "ann@x.test" }).exec(),
      ],
      [
        { update: { $set: { note: "n" } } },
        () => Users.updateOne({ name: "Ann" }, { $set: { age: 2 } }).exec(),
        () => Users.updateOne({ name: "Ann" }, { $set: { age: 2, note: "n" } }).exec(),
      ],
      [
        { where: { name: "x" } },
        () => Trash.deleteMany({ name: { $in: ["x", "y"] } }).exec(),
        () => Trash.deleteMany({ $and: [{ name: { $in: ["x", "y"] } }, { name: "x" }] }).exec(),
      ],
    ];
    for (const [change, changed, direct] of cases) {
      states.length = 0;
      ModifyPlan.reset();
      ModifyPlan.next = change;
      await changed();
      ModifyPlan.reset();
      await direct();
      expect(states.length).toBe(2);
      expect(states[0]).toEqual(states[1]);
    }
  });

  test("a value step only ADDS locals: what existed before the steps is untouched (the snapshot relies on it)", async () => {
    const violations: string[] = [];
    let checked = 0;
    let before: (readonly [symbol, unknown])[] = [];
    let plan: Record<string, unknown> = {};
    use({
      normalize: around(
        "normalize",
        (ctx) => {
          before = [...ctx.locals];
          /* cast: the plan read by key, as the snapshot reads it (a plan kind has no index signature) */
          plan = ctx.plan as unknown as Record<string, unknown>;
          /* The working values the steps receive are the plan's (the snapshot takes them from the plan). A write
             through documents (`insertMany`) fills its values from the documents' preparation inside the operation;
             its event takes no change, so no snapshot is ever taken of it. */
          if (ctx.document?.prepare !== undefined) return;
          for (const field of OperationContext.VALUE_FIELDS) {
            if (ctx[field] !== plan[field]) violations.push(`${ctx.op}: ${field} is not the plan's before normalize`);
          }
        },
        none,
      ),
      validate: around("validate", none, (ctx) => {
        checked++;
        const now = [...ctx.locals];
        before.forEach(([key, value], index) => {
          const entry = now[index];
          if (entry?.[0] !== key || entry[1] !== value) violations.push(`${ctx.op}: ${String(key)} was rewritten`);
        });
      }),
    });
    await t.mongo.db.collection("hm_users").insertOne({ name: "Ann", age: 1 });
    await Users.find({ name: "Ann" });
    await Users.find({ name: "Ann" }).explain();
    for await (const _ of Users.find({ name: "Ann" }).cursor()) void _;
    await Users.countDocuments({ name: "Ann" });
    await Users.updateOne({ name: "Ann" }, { $inc: { age: 1 } });
    await Users.findOneAndUpdate({ name: "Ann" }, { $set: { note: "x" } }).lean();
    await Users.insertMany([{ name: "B" }, { name: 5 as never }], { ordered: false }).catch(() => undefined);
    await Ledger.updateOne({ name: "Ann" }, { $set: { n: 1 } });
    await Trash.deleteMany({ name: "x" });
    await inTenant("ta", () =>
      Accounts.bulkWrite([
        { insertOne: { document: { name: "z" } } },
        { updateOne: { filter: { name: "z" }, update: { $set: { qty: 1 } } } },
      ]),
    );
    await inTenant("ta", () => Invoices.aggregate((p) => p.sort({ total: 1 })));
    await t.connection.transaction(async () => {
      await Users.updateOne({ name: "Ann" }, { $set: { age: 3 } });
    });
    expect(violations).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});

describe("the control state of the operation outlives a hook's change", () => {
  /**
   * The `operation.step` events of one `find` with a subscriber.
   * @param next The change the hook makes, or undefined for none.
   * @returns The step names in event order.
   */
  const stepsOf = async (next: unknown): Promise<string[]> => {
    const events: InstrumentationEvent[] = [];
    const subscription = t.client.instrument({ handle: (event) => events.push(event) });
    try {
      ModifyPlan.next = next;
      await Users.find({ name: "Ann" });
    } finally {
      subscription.unsubscribe();
    }
    return events.flatMap((event) => (event.type === "operation.step" ? [event.step] : []));
  };

  test("the cast/validate step events held before operation.start are not lost when a pre hook modifies", async () => {
    const plain = await stepsOf(undefined);
    expect(plain.slice(0, 3)).toEqual(["cast", "validate", "hooksPre"]);
    const modified = await stepsOf({ where: { age: 3 } });
    expect(modified).toEqual(plain);
  });
});

describe("skip() after modify() in the same pre hook", () => {
  test("the skip result is returned, nothing is sent, the later pre hooks do not run", async () => {
    await t.mongo.db.collection("hm_users").insertOne({ name: "Ann", age: 3 });
    t.commands.clear();
    const planned = [{ name: "from skip" }];
    ModifyPlan.next = { where: { age: 3 } };
    ModifyPlan.skipWith = planned;
    const result: unknown = await Users.find({ name: "Ann" });
    /* The rollback of the change (`restore`) must not erase the skip: else the find is sent and returns Ann. */
    expect(result).toEqual(planned);
    expect(t.commands.byName("find")).toEqual([]);
    expect(ModifyPlan.seen).toEqual([]);
    expect(ModifyPlan.errors).toEqual([]);
  });

  test("an update skipped after a modify changes nothing in the database", async () => {
    await t.mongo.db.collection("hm_users").insertOne({ name: "Bob", age: 1 });
    t.commands.clear();
    const planned = { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
    ModifyPlan.next = { update: { $set: { note: "hook" } } };
    ModifyPlan.skipWith = planned;
    const result: unknown = await Users.updateOne({ name: "Bob" }, { $set: { age: 2 } });
    expect(result).toEqual(planned);
    expect(t.commands.byName("update")).toEqual([]);
    const stored = await t.mongo.db.collection("hm_users").findOne({ name: "Bob" });
    expect(stored?.age).toBe(1);
    expect(stored?.note).toBeUndefined();
  });
});
