import { AsyncLocalStorage } from "node:async_hooks";
import { QueryError } from "../errors/query-error.ts";
import { StrictModeError } from "../errors/strict-mode-error.ts";

/*
 * The context of the application policies: the tenant, the actor of the audit, and
 * what the soft delete policy shows. It reaches an operation EXPLICITLY — `.policy({ tenant })` on a
 * builder, `{ policy }` in the options of the writes without one — or from the ambient scope
 * `PolicyContext.run(values, work)` (ALS). Never through flags or symbols on queries: the pipeline step
 * `resolveContext` puts the values into `ctx.policy`, where the policies, the hooks and the audit read them.
 *
 * The ambient scope is taken when the operation is BUILT (a query builder, an insert, a save), not when it
 * is awaited: `await PolicyContext.run(ctx, () => Users.find())` awaits outside the
 * scope, and a builder kept in a module variable must not change its tenant with the request that awaits
 * it — a read's result is cached per builder object, so a builder run in one tenant and awaited again
 * in another would hand over the first tenant's documents. A builder made outside any scope has no tenant
 * (a tenant-scoped model refuses it) unless `.policy({ tenant })` gives one.
 */

/**
 * The values of the policy context (every one optional; unknown keys are refused).
 *
 * @example
 * const values: PolicyValues = { tenant: "acme", actor: "user-1" };
 */
export interface PolicyValues {
  /**
   * The tenant (tenant policy): the value of the model's tenant field — cast by the field's type
   * (a string, a number, an ObjectId, …). Required by every operation of a tenant-scoped model.
   */
  readonly tenant?: unknown;
  /** Cross-tenant work (an admin job): the tenant policy does not scope. Explicit, never a default. */
  readonly allTenants?: true;
  /** Who acts (audit policy): recorded in every audit entry. */
  readonly actor?: unknown;
  /** Soft delete: the operation sees deleted documents too (reads and writes of the model itself). */
  readonly includeDeleted?: true;
  /** Soft delete: the operation sees ONLY deleted documents (`restore`, purge). */
  readonly onlyDeleted?: true;
  /**
   * Soft delete: a delete removes the documents for good (`SoftDelete.purge`); without it a delete of a
   * soft-delete model is an update of the delete date.
   */
  readonly hardDelete?: true;
}

/** The keys a policy context may hold. */
const KEYS: ReadonlySet<string> = new Set([
  "tenant",
  "allTenants",
  "actor",
  "includeDeleted",
  "onlyDeleted",
  "hardDelete",
]);
/** The keys that are flags: `true` or absent. */
const FLAGS = ["allTenants", "includeDeleted", "onlyDeleted", "hardDelete"] as const;

/** The ambient scope. */
const STORE = new AsyncLocalStorage<Readonly<PolicyValues>>();
/** The context without values. */
const EMPTY: Readonly<PolicyValues> = Object.freeze({});

/**
 * The ambient and explicit policy context.
 *
 * @example
 * await PolicyContext.run({ tenant: "acme" }, () => User.find()); // the find is built in the scope of "acme"
 */
export class PolicyContext {
  /** No values. */
  static readonly EMPTY: Readonly<PolicyValues> = EMPTY;

  /**
   * Runs `work` with these values in the ambient scope (ALS), merged over the enclosing scope's (an inner
   * `tenant` replaces the outer one). Operations BUILT inside take them.
   *
   * @typeParam R - What `work` returns.
   * @param values - The values to set.
   * @param work - The work to run in the scope.
   * @returns What `work` returns.
   * @throws {QueryError} When `values` are invalid.
   * @throws {StrictModeError} With reason `tenant` for an empty tenant.
   */
  static run<R>(values: PolicyValues, work: () => R): R {
    return STORE.run(PolicyContext.merge(STORE.getStore() ?? EMPTY, values, "PolicyContext.run"), work);
  }

  /**
   * The ambient values (`undefined` outside every `run`).
   *
   * @returns The values, or `undefined`.
   */
  static current(): Readonly<PolicyValues> | undefined {
    return STORE.getStore();
  }

  /**
   * The plan options part holding the ambient values when an operation is built (none outside a scope). Public
   * for wrappers and plugins that build a plan themselves (a custom query layer, a plugin that composes
   * operations); application code sets the scope with {@link PolicyContext.run}.
   *
   * @returns `{ policy }` to spread into the plan options.
   */
  static captured(): { readonly policy: Readonly<PolicyValues> } {
    return { policy: STORE.getStore() ?? EMPTY };
  }

  /**
   * `extra` over `base`, checked (unknown keys, flags that are not `true`, contradictions): a frozen copy.
   * Public for wrappers and plugins that combine policy values of their own with the ambient ones; application
   * code passes them to an operation (`.tenant()`, `.includeDeleted()`, …) instead.
   *
   * @param base - The values so far, if any.
   * @param extra - The values to set over them.
   * @param where - The call name, for error messages.
   * @returns The merged, frozen values.
   * @throws {QueryError} When `extra` has unknown keys, a flag that is not `true`, or contradicting values.
   */
  static merge(base: Readonly<PolicyValues> | undefined, extra: PolicyValues, where: string): Readonly<PolicyValues> {
    PolicyContext.check(extra, where);
    const merged: Record<string, unknown> = { ...(base ?? EMPTY) };
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) merged[key] = value;
    }
    /* An explicit tenant ends an inherited cross-tenant scope, and the other way round. */
    if (extra.tenant !== undefined) delete merged.allTenants;
    if (extra.allTenants === true) delete merged.tenant;
    if (extra.includeDeleted === true) delete merged.onlyDeleted;
    if (extra.onlyDeleted === true) delete merged.includeDeleted;
    return Object.freeze(merged) as Readonly<PolicyValues>;
  }

  /**
   * Whether a tenant value is no tenant: `null`, an empty or a whitespace-only string (`undefined` is "not given").
   *
   * @param tenant - The tenant value.
   * @returns `true` for a blank tenant.
   */
  static blankTenant(tenant: unknown): boolean {
    return tenant === null || (typeof tenant === "string" && tenant.trim() === "");
  }

  /**
   * Checks the values of one call.
   *
   * @param values - The values.
   * @param where - The call name, for error messages.
   * @throws {QueryError} When the values are not an object, have unknown keys, a flag that is not `true`, or
   * contradicting values.
   * @throws {StrictModeError} With reason `tenant` for a `null`, empty or whitespace-only tenant.
   */
  private static check(values: PolicyValues, where: string): void {
    if (typeof values !== "object" || values === null || Array.isArray(values)) {
      throw new QueryError(`${where}: the policy values are an object ({ tenant, actor, includeDeleted, … })`);
    }
    const unknown = Object.keys(values).filter((key) => !KEYS.has(key));
    if (unknown.length > 0) {
      throw new QueryError(`${where}: unknown policy value "${unknown.join('", "')}" (known: ${[...KEYS].join(", ")})`);
    }
    for (const flag of FLAGS) {
      const value = values[flag];
      if (value !== undefined && value !== true) throw new QueryError(`${where}: ${flag} is \`true\` or absent`);
    }
    if (PolicyContext.blankTenant(values.tenant)) {
      throw new StrictModeError(
        "tenant",
        `${where}: the tenant is empty (${JSON.stringify(values.tenant)}); a tenant is a non-empty value, or allTenants: true for cross-tenant work`,
        { path: "tenant" },
      );
    }
    if (values.tenant !== undefined && values.allTenants === true) {
      throw new QueryError(`${where}: tenant and allTenants contradict each other`);
    }
    if (values.includeDeleted === true && values.onlyDeleted === true) {
      throw new QueryError(`${where}: includeDeleted and onlyDeleted contradict each other`);
    }
  }
}
