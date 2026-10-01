/*
 * Entities whose pre hooks change the operation — `ModifyPlan.next` is the change
 * the first pre hook makes (set by the tests, any shape: the runtime must refuse the invalid ones), the second pre
 * hook records what it sees, `postError` records the failure.
 */
import type { ObjectId } from "mongodb";
import {
  Entity,
  type Hidden,
  type Immutable,
  type OperationChange,
  type OperationHookContext,
  type OperationHookEvent,
  PostError,
  Pre,
  Prop,
  Schema,
  Tenant,
  type TenantField,
  Types,
} from "../../../src/index.ts";

/** The state shared by the hooks of the `Mod*` entities: what to change, and what the hooks saw. */
export class ModifyPlan {
  /** The change the first pre hook makes (`undefined`: none). */
  static next: unknown;
  /** What the second pre hook saw: the operation's values (database form) after the first one. */
  static seen: {
    readonly filter: unknown;
    readonly update: unknown;
    readonly pipeline: unknown;
    readonly operations: unknown;
    /** Two reads of `this.update` / `this.pipeline` give the same object. */
    readonly stable: boolean;
  }[] = [];
  /** `<event> <error name>` of every postError call. */
  static errors: string[] = [];
  /** What the first pre hook read as `this.pipeline` (else `this.update`) BEFORE its change. */
  static viewBefore: unknown;
  /** When set, the first pre hook calls `skip(skipWith)` right AFTER its `modify`. */
  static skipWith: unknown;

  /** Clears the change, the records and the skip result. */
  static reset(): void {
    ModifyPlan.next = undefined;
    ModifyPlan.seen = [];
    ModifyPlan.errors = [];
    ModifyPlan.viewBefore = undefined;
    ModifyPlan.skipWith = undefined;
  }
}

/** The operation events the `ModUser` hooks listen to. */
const EVENTS = [
  "query.find",
  "query.findOne",
  "query.countDocuments",
  "query.updateOne",
  "query.findOneAndUpdate",
  "query.deleteMany",
  "model.insertMany",
  "aggregate",
] as const satisfies readonly OperationHookEvent[];

/**
 * The first pre hook: makes `ModifyPlan.next`.
 *
 * @param hook - the hook context of the running operation
 */
const change = <T>(hook: OperationHookContext<T>): void => {
  const next = ModifyPlan.next;
  ModifyPlan.viewBefore = hook.pipeline ?? hook.update;
  /* cast: the tests give changes of every shape, including invalid ones the runtime must refuse */
  if (next !== undefined) hook.modify(next as OperationChange<T, OperationHookEvent>);
  /* cast: the tests give a skip result per event (find: documents, updateOne: an UpdateResult) */
  if (ModifyPlan.skipWith !== undefined) hook.skip(ModifyPlan.skipWith as Parameters<typeof hook.skip>[0]);
};

/**
 * Whether two reads of a getter give the same object.
 *
 * @param read - reads the getter
 * @returns `true` when both reads are identical
 */
const sameTwice = (read: () => unknown): boolean => {
  const first = read();
  return read() === first;
};

/**
 * The second pre hook: records what it sees.
 *
 * @param hook - the hook context of the running operation
 */
const look = <T>(hook: OperationHookContext<T>): void => {
  ModifyPlan.seen.push({
    filter: hook.filter,
    update: hook.update,
    pipeline: hook.pipeline,
    operations: hook.operations,
    stable: sameTwice(() => hook.update) && sameTwice(() => hook.pipeline),
  });
};

/** Events of the models below (a model with `dbName` and a tenant, a soft-delete model). */
const MORE_EVENTS = [
  "query.find",
  "query.updateOne",
  "query.deleteMany",
  "model.insertMany",
  "model.bulkWrite",
  "aggregate",
] as const satisfies readonly OperationHookEvent[];

/**
 * The `postError` hook: records `<event> <error name>`.
 *
 * @param hook - the hook context of the failed operation
 * @param error - the error the operation raised
 */
const failed = <T>(hook: OperationHookContext<T>, error: unknown): void => {
  ModifyPlan.errors.push(`${hook.event} ${(error as Error).name}`);
};

/** A plain entity with a lowercased and an immutable field; both pre hooks and `postError` on eight events. */
@Schema({ collection: "hm_users" })
export class ModUser extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { lowercase: true })
  email?: string;

  @Prop(() => Number)
  age?: number;

  @Prop(() => String, { immutable: true })
  code?: Immutable<string>;

  @Prop(() => String)
  note?: string;

  @Pre(EVENTS)
  first(this: OperationHookContext<ModUser>): void {
    change(this);
  }

  @Pre(EVENTS)
  second(this: OperationHookContext<ModUser>): void {
    look(this);
  }

  @PostError(EVENTS)
  failure(this: OperationHookContext<ModUser>, error: unknown): void {
    failed(this, error);
  }
}

/** A tenant-scoped entity with a hidden field; only `query.find` is hooked. */
@Schema({ collection: "hm_customers", tenant: true })
export class ModCustomer extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;

  @Pre(["query.find"])
  first(this: OperationHookContext<ModCustomer>): void {
    change(this);
  }
}

/** A tenant-scoped entity that refers to a customer; its `aggregate` pipeline is hooked. */
@Schema({ collection: "hm_invoices", tenant: true })
export class ModInvoice extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => Types.ObjectId, { required: true })
  customer!: ObjectId;

  @Prop(() => Number, { required: true })
  total!: number;

  @Pre("aggregate")
  first(this: OperationHookContext<ModInvoice, "aggregate">): void {
    change(this);
  }

  @Pre("aggregate")
  second(this: OperationHookContext<ModInvoice, "aggregate">): void {
    look(this);
  }
}

/** An audited entity; `query.updateOne` is hooked, so the audit sees the hook's change. */
@Schema({ collection: "hm_ledger", audit: true })
export class ModLedger extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number)
  n?: number;

  @Prop(() => String)
  note?: string;

  @Pre("query.updateOne")
  first(this: OperationHookContext<ModLedger, "query.updateOne">): void {
    change(this);
  }
}

/** Fields renamed by `dbName` and a tenant — a second run of the steps over encoded values would fail. */
@Schema({ collection: "hm_accounts", tenant: true })
export class ModAccount extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true, dbName: "n" })
  name!: string;

  @Prop(() => Number, { dbName: "q" })
  qty?: number;

  @Pre(MORE_EVENTS)
  first(this: OperationHookContext<ModAccount>): void {
    change(this);
  }

  @Pre(MORE_EVENTS)
  second(this: OperationHookContext<ModAccount>): void {
    look(this);
  }

  @PostError(MORE_EVENTS)
  failure(this: OperationHookContext<ModAccount>, error: unknown): void {
    failed(this, error);
  }
}

/** A soft-delete model with a renamed field — a delete a hook narrows is still a soft delete. */
@Schema({ collection: "hm_trash", softDelete: true })
export class ModTrash extends Entity {
  @Prop(() => String, { required: true, dbName: "n" })
  name!: string;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;

  @Pre(MORE_EVENTS)
  first(this: OperationHookContext<ModTrash>): void {
    change(this);
  }

  @PostError(MORE_EVENTS)
  failure(this: OperationHookContext<ModTrash>, error: unknown): void {
    failed(this, error);
  }
}
