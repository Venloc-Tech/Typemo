/*
 * Group L: entities with Typemo's built-in mechanisms (hooks through a plugin, tenant, soft delete, audit)
 * and the Mongoose equivalents written as ordinary plugins/middleware — what an application would write
 * for Mongoose, which has none of these built in. Each mechanism has its own collection.
 */
import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { Entity, Plugin, Prop, Schema, type SchemaPlugin, Tenant, type TenantField } from "@venloc/typemo";
import type { Db } from "mongodb";
import type { Model, Mongoose, Schema as MSchema, Query } from "mongoose";
import type { MongooseHandle } from "../../adapters/bench-context.ts";
import { ISeed } from "./populate-models.ts";

/** The collections of group L, one per mechanism. */
export const L_COLLECTIONS = {
  hooks: "bb_l_hooks",
  tenant: "bb_l_tenant",
  soft: "bb_l_soft",
  audited: "bb_l_audited",
  audit: "bb_l_audited_audit",
  users: "bb_l_users",
} as const;
/** The collection that records how many documents are seeded. */
const L_MARKER = "bb_l_marker";
/** The number of tenants in the seeded data. */
export const L_TENANTS = 10;

/** Counts hook calls (every contestant's hooks increment it; the scenario checks calls per operation). */
export class HookCounter {
  /** Calls so far. */
  static calls = 0;
  /** Records one hook call. */
  static hit(): void {
    HookCounter.calls++;
  }
}

/**
 * A plugin that adds a number of `pre findOne` hooks.
 *
 * @param n - How many hooks.
 * @returns The plugin.
 */
const hooksPlugin = (n: number): SchemaPlugin => ({
  name: `bb-hooks-${n}`,
  apply: (builder) => {
    for (let i = 0; i < n; i++) builder.addHook("pre", "query.findOne", HookCounter.hit);
  },
});

/** An entity with no hooks. */
@Plugin(hooksPlugin(0))
@Schema({ collection: L_COLLECTIONS.hooks })
export class LHook0 extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  n!: number;
}

/** An entity with one hook. */
@Plugin(hooksPlugin(1))
@Schema({ collection: L_COLLECTIONS.hooks })
export class LHook1 extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  n!: number;
}

/** An entity with ten hooks. */
@Plugin(hooksPlugin(10))
@Schema({ collection: L_COLLECTIONS.hooks })
export class LHook10 extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  n!: number;
}

/** The hook entities by hook count. */
export const L_HOOK_ENTITIES = { 0: LHook0, 1: LHook1, 10: LHook10 } as const;

/** A tenant-scoped item. */
@Schema({ collection: L_COLLECTIONS.tenant, tenant: true })
export class LTenantItem extends Entity {
  /** The tenant; the core fills it. */
  @Prop(() => String, { required: true })
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  status!: string;

  @Prop(() => Number, { required: true })
  n!: number;
}

/** A soft-deletable item. */
@Schema({ collection: L_COLLECTIONS.soft, softDelete: true })
export class LSoftItem extends Entity {
  @Prop(() => String, { required: true })
  status!: string;

  @Prop(() => Number, { required: true })
  n!: number;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}

/** An item whose updates are journaled. */
@Schema({ collection: L_COLLECTIONS.audited, audit: true })
export class LAuditedItem extends Entity {
  @Prop(() => String, { required: true })
  status!: string;

  @Prop(() => Number, { required: true })
  n!: number;
}

/** A user, found by email. */
@Schema({ collection: L_COLLECTIONS.users })
export class LUser extends Entity {
  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => String, { required: true })
  name!: string;
}

/**
 * A loosely typed Mongoose model.
 *
 * @example
 * ```ts
 * const Items: MModel = LMongoose.tenant(handle);
 * ```
 */
type MModel = Model<Record<string, unknown>>;
/**
 * A loosely typed Mongoose query.
 *
 * @example
 * ```ts
 * schema.pre("find", function (this: AnyQuery) { this.where({}); });
 * ```
 */
type AnyQuery = Query<unknown, unknown>;

/** The tenant of the current request for the Mongoose plugin (Typemo has `PolicyContext`, also ALS). */
export const MONGOOSE_TENANT = new AsyncLocalStorage<{ readonly tenant: string }>();

/** The query operations the tenant plugin scopes. */
const QUERY_OPS = [
  "find",
  "findOne",
  "countDocuments",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
] as const;

/** Mongoose plugins equivalent to the Typemo policies (the minimum an application would write). */
export class LMongoosePlugins {
  /**
   * Tenant: every query gets `tenantId` from the ALS; new documents are stamped; no tenant → error.
   *
   * @param schema - The schema to extend.
   */
  static tenant(schema: MSchema): void {
    const tenant = (): string => {
      const store = MONGOOSE_TENANT.getStore();
      if (store === undefined) throw new Error("tenant plugin: no tenant in scope");
      return store.tenant;
    };
    schema.pre([...QUERY_OPS], function (this: AnyQuery) {
      this.where({ tenantId: tenant() });
    });
    schema.pre("validate", function (this: { tenantId?: unknown }) {
      if (this.tenantId === undefined) this.tenantId = tenant();
      else if (this.tenantId !== tenant()) throw new Error("tenant plugin: foreign tenant");
    });
  }

  /**
   * Soft delete: reads see live documents only; `softDeleteOne` marks instead of deleting.
   *
   * @param schema - The schema to extend.
   */
  static softDelete(schema: MSchema): void {
    schema.pre(["find", "findOne", "countDocuments"], function (this: AnyQuery) {
      this.where({ deletedAt: null });
    });
    schema.static("softDeleteOne", function (this: MModel, filter: Record<string, unknown>) {
      return this.updateOne({ ...filter, deletedAt: null }, { $set: { deletedAt: new Date() } });
    });
  }

  /**
   * Audit: one journal entry per updateOne, written after the write (no session: outside any transaction).
   *
   * @param journal - Returns the journal model.
   * @returns The plugin function.
   */
  static audit(journal: () => MModel) {
    return (schema: MSchema): void => {
      schema.post("updateOne", { document: false, query: true }, async function (res: unknown) {
        const result = res as { matchedCount?: number; modifiedCount?: number };
        await journal().create({
          at: new Date(),
          model: this.model.modelName,
          collection: this.model.collection.collectionName,
          operation: "updateOne",
          filter: this.getFilter(),
          update: this.getUpdate(),
          result: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
        });
      });
    };
  }
}

/**
 * A schema with a status and a number, plus extra paths.
 *
 * @param m - The Mongoose instance.
 * @param extra - Extra schema paths.
 * @returns The schema.
 */
const plain = (m: Mongoose, extra: Record<string, unknown> = {}): MSchema =>
  new m.Schema({ status: { type: String, required: true }, n: { type: Number, required: true }, ...extra });

/** The Mongoose models of group L. */
export class LMongoose {
  /**
   * The hooks model.
   *
   * @param handle - The Mongoose contestant.
   * @param n - How many hooks.
   * @returns The model.
   */
  static hooks(handle: MongooseHandle, n: 0 | 1 | 10): MModel {
    return handle.model(`BbLHook${n}`, L_COLLECTIONS.hooks, (m) => {
      const schema = new m.Schema({ name: { type: String, required: true }, n: { type: Number, required: true } });
      for (let i = 0; i < n; i++) schema.pre("findOne", HookCounter.hit);
      return schema;
    });
  }

  /**
   * The tenant-scoped model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static tenant(handle: MongooseHandle): MModel {
    return handle.model("BbLTenant", L_COLLECTIONS.tenant, (m) => {
      const schema = plain(m, { tenantId: { type: String, required: true } });
      schema.plugin(LMongoosePlugins.tenant);
      return schema;
    });
  }

  /**
   * The soft-delete model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model, with the `softDeleteOne` static.
   */
  static soft(handle: MongooseHandle): MModel & { softDeleteOne(filter: object): Promise<unknown> } {
    return handle.model("BbLSoft", L_COLLECTIONS.soft, (m) => {
      const schema = plain(m, { deletedAt: { type: Date, default: null } });
      schema.plugin(LMongoosePlugins.softDelete);
      return schema;
    }) as MModel & { softDeleteOne(filter: object): Promise<unknown> };
  }

  /**
   * The audited model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static audited(handle: MongooseHandle): MModel {
    const journal = (): MModel =>
      handle.model("BbLAuditJournal", L_COLLECTIONS.audit, (m) => new m.Schema({}, { strict: false }));
    return handle.model("BbLAudited", L_COLLECTIONS.audited, (m) => {
      const schema = plain(m);
      schema.plugin(LMongoosePlugins.audit(journal));
      return schema;
    });
  }

  /**
   * The users model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static users(handle: MongooseHandle): MModel {
    return handle.model(
      "BbLUser",
      L_COLLECTIONS.users,
      (m) => new m.Schema({ email: { type: String, required: true }, name: { type: String, required: true } }),
    );
  }
}

/** Seeds the collections of group L. */
export class LSeed {
  /**
   * The id of a seeded document.
   *
   * @param code - The collection code.
   * @param i - The document index.
   * @returns The deterministic id.
   */
  static oid(code: number, i: number) {
    return ISeed.oid(0x30 + code, i);
  }

  /**
   * Status of document i: alternates in runs of 10, independent of the tenant (i % 10).
   *
   * @param i - The document index.
   * @returns `open` or `closed`.
   */
  static status(i: number): "open" | "closed" {
    return Math.floor(i / 10) % 2 === 0 ? "open" : "closed";
  }

  /**
   * Soft-delete seed: every 10th document is deleted.
   *
   * @param i - The document index.
   * @returns `true` for a deleted document.
   */
  static deleted(i: number): boolean {
    return i % 10 === 0;
  }

  /**
   * How many of the first `docs` indexes satisfy `predicate` (expected counts of the scenarios).
   *
   * @param docs - How many indexes to test.
   * @param predicate - The condition.
   * @returns The count.
   */
  static countWhere(docs: number, predicate: (i: number) => boolean): number {
    let n = 0;
    for (let i = 0; i < docs; i++) if (predicate(i)) n++;
    return n;
  }

  /**
   * All L collections, `docs` documents each (idempotent).
   *
   * @param db - The database.
   * @param docs - Documents per collection.
   */
  static async seed(db: Db, docs: number): Promise<void> {
    const marker = db.collection<{ _id: string; docs: number }>(L_MARKER);
    if ((await marker.findOne({ _id: "l2" }))?.docs === docs) return;
    await marker.deleteMany({});
    for (const name of Object.values(L_COLLECTIONS)) await db.collection(name).deleteMany({});
    const range = Array.from({ length: docs }, (_, i) => i);
    const status = LSeed.status;
    await db
      .collection(L_COLLECTIONS.hooks)
      .insertMany(range.map((i) => ({ _id: LSeed.oid(0, i), name: `h${i}`, n: i })));
    await db
      .collection(L_COLLECTIONS.tenant)
      .insertMany(range.map((i) => ({ _id: LSeed.oid(1, i), tenantId: `t${i % L_TENANTS}`, status: status(i), n: i })));
    await db.collection(L_COLLECTIONS.soft).insertMany(
      range.map((i) => ({
        _id: LSeed.oid(2, i),
        status: status(i),
        n: i,
        deletedAt: LSeed.deleted(i) ? new Date(Date.UTC(2026, 0, 1)) : null,
      })),
    );
    await db
      .collection(L_COLLECTIONS.audited)
      .insertMany(range.map((i) => ({ _id: LSeed.oid(3, i), status: status(i), n: 0 })));
    await db
      .collection(L_COLLECTIONS.users)
      .insertMany(range.map((i) => ({ _id: LSeed.oid(4, i), email: `user${i}@example.test`, name: `user ${i}` })));
    await db.collection(L_COLLECTIONS.tenant).createIndex({ tenantId: 1, status: 1 });
    await db.collection(L_COLLECTIONS.users).createIndex({ email: 1 }, { unique: true });
    await marker.insertOne({ _id: "l", docs });
  }
}
