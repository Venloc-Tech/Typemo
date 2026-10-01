/*
 * Group L — mechanisms. Typemo's built-in hooks and policies against the same behaviour written as Mongoose
 * plugins/middleware (`support-bb/mechanism-models.ts`) and by hand with the driver (the floor).
 *  - L.hooks.findOne.{0,1,10}: N `pre findOne` hooks (a counter); calls per operation verified = N.
 *  - L.tenant.find / L.tenant.insert: tenant from AsyncLocalStorage (Typemo PolicyContext / Mongoose plugin).
 *  - L.softDelete.find / L.softDelete.delete: live documents only; delete = mark `deletedAt`.
 *  - L.audit.update: updateOne + one journal entry (Typemo: same session, built in; Mongoose: post hook).
 *  - L.sanitize.findOne: `untrusted(input)` (Typemo) vs `sanitizeFilter` (Mongoose safe) on a findOne by email.
 *  - L.untrusted.check: the check alone on a request-like body (no server): `untrusted()` vs
 *    `mongoose.sanitizeFilter()` (different semantics: Typemo throws on a `$` key, Mongoose wraps it in `$eq`;
 *    the body here is clean, so both return it unchanged).
 */
import { PolicyContext, untrusted } from "@venloc/typemo";
import type { Db, Document, ObjectId } from "mongodb";
import mongoose from "mongoose";
import type { MongooseHandle } from "../adapters/bench-context.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { BbChecksum } from "./support-bb/bb-checksum.ts";
import {
  HookCounter,
  L_COLLECTIONS,
  L_HOOK_ENTITIES,
  L_TENANTS,
  LAuditedItem,
  LMongoose,
  LSeed,
  LSoftItem,
  LTenantItem,
  LUser,
  MONGOOSE_TENANT,
} from "./support-bb/mechanism-models.ts";

/** Documents per dataset size. */
const DOCS_OF: Readonly<Record<SizeName, number>> = { T: 100, S: 1_000, M: 100_000, L: 100_000, XL: 100_000 };
/** The tenant every tenant scenario works as. */
const TENANT = "t3";

/** Base: seeds the L collections into the contestants' databases; S in standard, S+M in full. */
abstract class MechanismScenario extends Scenario {
  readonly group = "L" as const;
  override readonly sizes: readonly SizeName[] = ["S", "M"];

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns S for `standard` and `quick`, S and M for `full`, none for `heavy`.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    if (!this.profiles.includes(profile)) return [];
    return profile === "full" ? ["S", "M"] : profile === "heavy" ? [] : ["S"];
  }

  /**
   * Seeds every contestant's database.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    for (const contestant of this.contestants) await LSeed.seed(env.ctx.dbOf(contestant), DOCS_OF[env.size]);
  }
}

/**
 * The outcome of documents, over the listed fields only.
 *
 * @param docs - The documents.
 * @param fields - The fields to compare.
 * @returns The count and a checksum.
 */
const docsOutcome = (docs: readonly unknown[], fields: readonly string[]): Outcome => {
  const lines = docs.map((doc) =>
    BbChecksum.canonical(Object.fromEntries(fields.map((f) => [f, (doc as Document)[f]]))),
  );
  return { count: lines.length, checksum: BbChecksum.of(lines) };
};

/** `findOne` with a number of `pre` hooks. */
class HooksScenario extends MechanismScenario {
  readonly id: string;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo", "typemo-lean"];
  override readonly notes =
    "findOne by _id with N synchronous pre-findOne hooks (Typemo: added by a plugin, Mongoose: schema.pre). " +
    "Driver = 0 hooks (the floor). Calls per operation verified.";

  /**
   * @param hooks - How many `pre` hooks the model has.
   */
  constructor(private readonly hooks: 0 | 1 | 10) {
    super();
    this.id = `L.hooks.findOne.${hooks}`;
    this.title = `findOne by _id with ${hooks} pre hook(s)`;
    this.profiles = hooks === 10 ? ["quick", "standard", "full"] : ["standard", "full"];
  }

  /**
   * Builds a contestant that reads by id and counts the hook calls.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const docs = DOCS_OF[env.size];
    const expected = contestant === "driver" ? 0 : this.hooks;
    const measured =
      (find: (id: ObjectId) => Promise<unknown>) =>
      async (i: number): Promise<{ doc: unknown; calls: number }> => {
        const before = HookCounter.calls;
        const doc = await find(LSeed.oid(0, i % docs));
        return { doc, calls: HookCounter.calls - before };
      };
    const impl = (find: (id: ObjectId) => Promise<unknown>) =>
      ScenarioKit.impl<{ doc: unknown; calls: number }>({
        run: measured(find),
        verify: (result, i) => {
          if (result.calls !== expected)
            throw new Error(`${contestant}: ${result.calls} hook calls, expected ${expected}`);
          const doc = result.doc as Document | null;
          if (doc === null || doc.n !== i % docs) throw new Error(`${contestant}: wrong document`);
          return docsOutcome([doc], ["name", "n"]);
        },
      });
    const Entity = L_HOOK_ENTITIES[this.hooks];
    return ScenarioKit.pick(
      {
        driver: () => {
          const items = env.ctx.driver.db.collection(L_COLLECTIONS.hooks);
          return impl((_id) => items.findOne({ _id }));
        },
        mongoose: () => {
          const Hooks = LMongoose.hooks(env.ctx.mongoose, this.hooks);
          return impl((_id) => Hooks.findOne({ _id }).exec());
        },
        typemo: () => {
          const Hooks = env.ctx.typemo.model(Entity);
          return impl((_id) => Hooks.findOne({ _id }).exec());
        },
        "typemo-lean": () => {
          const Hooks = env.ctx.typemoLean.model(Entity);
          return impl((_id) => Hooks.findOne({ _id }).lean().exec());
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** A tenant-scoped `find`. */
class TenantFind extends MechanismScenario {
  readonly id = "L.tenant.find";
  readonly title = "tenant-scoped find (status = open, 1 tenant of 10)";
  readonly profiles: readonly ProfileName[] = ["quick", "standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo", "typemo-lean"];
  override readonly notes =
    "Tenant from AsyncLocalStorage: Typemo PolicyContext.run (built in); Mongoose: a pre-query plugin adding " +
    "`tenantId` (written for this benchmark); driver: the tenant written into the filter.";

  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns The open documents of the tenant.
   */
  override unitsPerOp(size: SizeName): number {
    return LSeed.countWhere(DOCS_OF[size], (i) => `t${i % L_TENANTS}` === TENANT && LSeed.status(i) === "open");
  }

  /**
   * Builds a contestant that reads the tenant's open documents.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const expected = this.unitsPerOp(env.size);
    const impl = (run: () => Promise<readonly unknown[]>) =>
      ScenarioKit.impl<readonly unknown[]>({
        run,
        verify: (docs) => {
          if (docs.length !== expected) throw new Error(`${contestant}: ${docs.length} docs, expected ${expected}`);
          if (docs.some((doc) => (doc as Document).tenantId !== TENANT))
            throw new Error(`${contestant}: foreign tenant`);
          return docsOutcome(docs, ["_id", "tenantId", "status", "n"]);
        },
      });
    const sort = { _id: 1 } as const;
    return ScenarioKit.pick(
      {
        driver: () => {
          const items = env.ctx.driver.db.collection(L_COLLECTIONS.tenant);
          return impl(() => items.find({ status: "open", tenantId: TENANT }).sort(sort).toArray());
        },
        mongoose: () => {
          const Items = LMongoose.tenant(env.ctx.mongoose);
          return impl(() =>
            MONGOOSE_TENANT.run({ tenant: TENANT }, () => Items.find({ status: "open" }).sort(sort).exec()),
          );
        },
        typemo: () => {
          const Items = env.ctx.typemo.model(LTenantItem);
          return impl(() =>
            PolicyContext.run({ tenant: TENANT }, () => Items.find({ status: "open" }).sort(sort).exec()),
          );
        },
        "typemo-lean": () => {
          const Items = env.ctx.typemoLean.model(LTenantItem);
          return impl(() =>
            PolicyContext.run({ tenant: TENANT }, () => Items.find({ status: "open" }).sort(sort).lean().exec()),
          );
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** A tenant-stamped insert. */
class TenantInsert extends MechanismScenario {
  readonly id = "L.tenant.insert";
  readonly title = "tenant-stamped insert of one document";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo"];
  override readonly notes =
    "The tenant is not in the input: Typemo stamps it (policy), Mongoose via pre('save') of the plugin " +
    "(Model.create), driver writes it. Verified: the stored document carries the tenant.";

  /**
   * Builds a contestant that inserts one document and checks its tenant.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const db: Db = env.ctx.dbOf(contestant);
    const impl = (insert: (n: number) => Promise<unknown>) =>
      ScenarioKit.impl<unknown>({
        setup: async () => {
          await db.collection(L_COLLECTIONS.tenant).deleteMany({ status: "new" });
        },
        run: (i) => insert(1_000_000 + i),
        verify: async (_, i) => {
          const stored = await db.collection(L_COLLECTIONS.tenant).findOne({ status: "new", n: 1_000_000 + i });
          if (stored?.tenantId !== TENANT) throw new Error(`${contestant}: tenant ${String(stored?.tenantId)}`);
          return { count: 1, checksum: `tenant=${stored.tenantId}` };
        },
      });
    return ScenarioKit.pick(
      {
        driver: () => {
          const items = db.collection(L_COLLECTIONS.tenant);
          return impl((n) => items.insertOne({ tenantId: TENANT, status: "new", n }));
        },
        mongoose: () => {
          const Items = LMongoose.tenant(env.ctx.mongoose);
          return impl((n) => MONGOOSE_TENANT.run({ tenant: TENANT }, () => Items.create({ status: "new", n })));
        },
        typemo: () => {
          const Items = env.ctx.typemo.model(LTenantItem);
          return impl((n) => PolicyContext.run({ tenant: TENANT }, () => Items.insertOne({ status: "new", n })));
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** `find` of live documents of a soft-delete model. */
class SoftFind extends MechanismScenario {
  readonly id = "L.softDelete.find";
  readonly title = "soft delete: find live documents (status = open)";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo", "typemo-lean"];
  override readonly notes =
    "10% of documents are deleted (deletedAt set). Mongoose: a pre-find plugin adding deletedAt: null.";

  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns The open, not deleted documents.
   */
  override unitsPerOp(size: SizeName): number {
    return LSeed.countWhere(DOCS_OF[size], (i) => LSeed.status(i) === "open" && !LSeed.deleted(i));
  }

  /**
   * Builds a contestant that reads the live open documents.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const expected = this.unitsPerOp(env.size);
    const impl = (run: () => Promise<readonly unknown[]>) =>
      ScenarioKit.impl<readonly unknown[]>({
        run,
        verify: (docs) => {
          if (docs.length !== expected) throw new Error(`${contestant}: ${docs.length} docs, expected ${expected}`);
          return docsOutcome(docs, ["_id", "status", "n"]);
        },
      });
    const sort = { _id: 1 } as const;
    return ScenarioKit.pick(
      {
        driver: () => {
          const items = env.ctx.driver.db.collection(L_COLLECTIONS.soft);
          return impl(() => items.find({ status: "open", deletedAt: null }).sort(sort).toArray());
        },
        mongoose: () => {
          const Items = LMongoose.soft(env.ctx.mongoose);
          return impl(() => Items.find({ status: "open" }).sort(sort).exec());
        },
        typemo: () => {
          const Items = env.ctx.typemo.model(LSoftItem);
          return impl(() => Items.find({ status: "open" }).sort(sort).exec());
        },
        "typemo-lean": () => {
          const Items = env.ctx.typemoLean.model(LSoftItem);
          return impl(() => Items.find({ status: "open" }).sort(sort).lean().exec());
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** Soft-deleting one document. */
class SoftDeleteOne extends MechanismScenario {
  readonly id = "L.softDelete.delete";
  readonly title = "soft delete: deleteOne by _id (marks deletedAt)";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo"];
  override readonly notes =
    "Typemo: Model.deleteOne (the policy turns it into $set deletedAt). Mongoose: the plugin's softDeleteOne static. " +
    "Driver: updateOne with deletedAt: null in the filter. `before` restores the document (untimed).";

  /**
   * Builds a contestant that soft-deletes one document.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const db: Db = env.ctx.dbOf(contestant);
    /* Documents 1..9 are live and open. */
    const target = (i: number): ObjectId => LSeed.oid(2, 1 + (i % 9));
    const impl = (remove: (_id: ObjectId) => Promise<unknown>) =>
      ScenarioKit.impl<unknown>({
        before: async (i) => {
          await db.collection(L_COLLECTIONS.soft).updateOne({ _id: target(i) }, { $set: { deletedAt: null } });
        },
        run: (i) => remove(target(i)),
        verify: async (_, i) => {
          const stored = await db.collection(L_COLLECTIONS.soft).findOne({ _id: target(i) });
          if (!(stored?.deletedAt instanceof Date)) throw new Error(`${contestant}: not marked`);
          await db.collection(L_COLLECTIONS.soft).updateOne({ _id: target(i) }, { $set: { deletedAt: null } });
          return { count: 1, checksum: "marked" };
        },
      });
    return ScenarioKit.pick(
      {
        driver: () => {
          const items = db.collection(L_COLLECTIONS.soft);
          return impl((_id) => items.updateOne({ _id, deletedAt: null }, { $set: { deletedAt: new Date() } }));
        },
        mongoose: () => {
          const Items = LMongoose.soft(env.ctx.mongoose);
          return impl((_id) => Items.softDeleteOne({ _id }));
        },
        typemo: () => {
          const Items = env.ctx.typemo.model(LSoftItem);
          return impl((_id) => Items.deleteOne({ _id }).exec());
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** An audited update: the write plus one journal entry. */
class AuditUpdate extends MechanismScenario {
  readonly id = "L.audit.update";
  readonly title = "audited updateOne ($inc) + one journal entry";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo"];
  override readonly notes =
    "Typemo: @Schema({ audit: true }) — the entry is written in the operation's session after the write. " +
    "Mongoose: a post('updateOne') plugin inserting the entry (filter, update, counts). Driver: updateOne + insertOne.";

  /**
   * Builds a contestant that updates a document and checks the journal entry.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const db: Db = env.ctx.dbOf(contestant);
    const target = (i: number): ObjectId => LSeed.oid(3, i % 100);
    let journalBefore = 0;
    const impl = (update: (_id: ObjectId) => Promise<unknown>) =>
      ScenarioKit.impl<unknown>({
        before: async () => {
          journalBefore = await db.collection(L_COLLECTIONS.audit).countDocuments();
        },
        run: (i) => update(target(i)),
        verify: async () => {
          const after = await db.collection(L_COLLECTIONS.audit).countDocuments();
          if (after !== journalBefore + 1) throw new Error(`${contestant}: ${after - journalBefore} journal entries`);
          const last = await db.collection(L_COLLECTIONS.audit).find().sort({ $natural: -1 }).limit(1).next();
          return { count: 1, checksum: `op=${String(last?.operation)}` };
        },
      });
    return ScenarioKit.pick(
      {
        driver: () => {
          const items = db.collection(L_COLLECTIONS.audited);
          const journal = db.collection(L_COLLECTIONS.audit);
          return impl(async (_id) => {
            const filter = { _id };
            const update = { $inc: { n: 1 } };
            const result = await items.updateOne(filter, update);
            await journal.insertOne({
              at: new Date(),
              model: "LAuditedItem",
              collection: L_COLLECTIONS.audited,
              operation: "updateOne",
              filter,
              update,
              result: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
            });
            return result;
          });
        },
        mongoose: () => {
          const Items = LMongoose.audited(env.ctx.mongoose);
          return impl((_id) => Items.updateOne({ _id }, { $inc: { n: 1 } }).exec());
        },
        typemo: () => {
          const Items = env.ctx.typemo.model(LAuditedItem);
          return impl((_id) => Items.updateOne({ _id }, { $inc: { n: 1 } }).exec());
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** `findOne` by an email that comes from request input. */
class SanitizeFindOne extends MechanismScenario {
  readonly id = "L.sanitize.findOne";
  readonly title = "findOne by email from request input: untrusted() vs sanitizeFilter";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "mongoose-safe", "typemo"];
  override readonly notes =
    "Driver and Mongoose default: no protection (floor). Mongoose safe: sanitizeFilter. Typemo: " +
    "`untrusted(input)` plus the always-on SanitizePolicy.";

  /**
   * Builds a contestant that reads by an untrusted email.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const docs = DOCS_OF[env.size];
    /* What a request body gives: a string (not trusted). */
    const input = (i: number): unknown => JSON.parse(`"user${i % docs}@example.test"`);
    const impl = (find: (email: unknown) => Promise<unknown>) =>
      ScenarioKit.impl<unknown>({
        run: (i) => find(input(i)),
        verify: (doc, i) => {
          if ((doc as Document | null)?.email !== `user${i % docs}@example.test`)
            throw new Error(`${contestant}: miss`);
          return docsOutcome([doc], ["email", "name"]);
        },
      });
    const mongooseImpl = (handle: MongooseHandle) => () => {
      const Users = LMongoose.users(handle);
      return impl((email) => Users.findOne({ email }).exec());
    };
    return ScenarioKit.pick(
      {
        driver: () => {
          const users = env.ctx.driver.db.collection(L_COLLECTIONS.users);
          return impl((email) => users.findOne({ email }));
        },
        mongoose: mongooseImpl(env.ctx.mongoose),
        "mongoose-safe": mongooseImpl(env.ctx.mongooseSafe),
        typemo: () => {
          const Users = env.ctx.typemo.model(LUser);
          return impl((email) => Users.findOne({ email: untrusted(email as string) }).exec());
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** A request-like body: 30 fields, nested objects and arrays, no `$` keys. */
const REQUEST_BODY = Object.freeze({
  ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, `value ${i}`])),
  address: { city: "Oslo", zip: "0150", lines: ["a", "b"], geo: { lat: 59.9, lng: 10.7 } },
  tags: ["x", "y", "z", "w"],
  items: Array.from({ length: 5 }, (_, i) => ({ sku: `s${i}`, qty: i, meta: { note: `n${i}` } })),
  flags: { a: true, b: false },
  profile: { name: { first: "Ann", last: "Lee" }, age: 31 },
});

/** The operator-injection check alone, without a server. */
class UntrustedCheck extends Scenario {
  readonly id = "L.untrusted.check";
  readonly group = "L" as const;
  readonly title = "check a request body for operator injection (no server)";
  readonly profiles: readonly ProfileName[] = ["quick", "standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];
  override readonly notes =
    "Typemo `untrusted(body)` walks the whole value and throws on a `$` key; `mongoose.sanitizeFilter(body)` " +
    "wraps `$` keys in `$eq` (mutates). A clean 30-field nested body: both return it unchanged.";

  /**
   * Builds a contestant that checks a copy of the request body.
   *
   * @param contestant - Who runs.
   * @returns The implementation.
   */
  build(contestant: ContestantId): ContestantImpl<unknown> {
    const outcome = (value: unknown): Outcome => ({ count: 1, checksum: BbChecksum.of([BbChecksum.canonical(value)]) });
    return ScenarioKit.pick(
      {
        mongoose: () =>
          ScenarioKit.impl<unknown>({
            run: () => mongoose.sanitizeFilter(structuredClone(REQUEST_BODY) as Record<string, unknown>),
            verify: outcome,
          }),
        typemo: () =>
          ScenarioKit.impl<unknown>({
            /* The clone is paid by both so the cost difference is the check itself. */
            run: () => untrusted(structuredClone(REQUEST_BODY)),
            verify: outcome,
          }),
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** The scenarios of group L. */
export const SCENARIOS: readonly Scenario[] = [
  new HooksScenario(0),
  new HooksScenario(1),
  new HooksScenario(10),
  new TenantFind(),
  new TenantInsert(),
  new SoftFind(),
  new SoftDeleteOne(),
  new AuditUpdate(),
  new SanitizeFindOne(),
  new UntrustedCheck(),
];
