import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../../bson/bson-guards.ts";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import { EmptyLogicalPolicy } from "../../policies/empty-logical-policy.ts";
import { EmptyUpdatePolicy } from "../../policies/empty-update-policy.ts";
import { GuardScan } from "../../policies/guard-scan.ts";
import { LimitPolicy } from "../../policies/limit-policy.ts";
import { PolicyErrors } from "../../policies/policy-errors.ts";
import { RequireFilterPolicy } from "../../policies/require-filter-policy.ts";
import { SanitizePolicy } from "../../policies/sanitize-policy.ts";
import { StrictPathPolicy } from "../../policies/strict-path-policy.ts";
import { UndefinedPolicy } from "../../policies/undefined-policy.ts";
import type { PlanDocument } from "../../query/plan.ts";
import { ProjectionPlanner } from "../../query/projection-planner.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import type { OperationStep } from "../pipeline/operation-step.ts";
import { OperationView, type WorkUnit } from "./operation-view.ts";

/* The operations that take a projection. */
const PROJECTING: ReadonlySet<string> = new Set([
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
]);
/** The effective projection of a find without a user projection, per schema. */
const DEFAULT_PROJECTION = new WeakMap<CompiledSchema, { readonly value: PlanDocument | undefined }>();
/* The stages that must stay first in an aggregation. */
const FIRST_ONLY: ReadonlySet<string> = new Set([
  "$search",
  "$searchMeta",
  "$vectorSearch",
  "$rankFusion",
  "$scoreFusion",
]);

/**
 * The `normalize` step, a pure transformation of the context values. First the policies that judge the RAW input
 * (before anything interprets it: a `$where` never reaches a caster, an `undefined` is a policy error rather than a
 * cast error, `requireFilter` sees the user's filter before the core adds clauses); then the normalization:
 * - the discriminator of a discriminator model: its key in every filter and a leading `$match` in an aggregation
 *   (Mongoose gh-3304 / H444; `estimatedDocumentCount` cannot filter, so it is an error, not the count of the whole
 *   collection);
 * - the effective projection of find/findOneAnd*: `Hidden` fields excluded, `+field` resolved
 *   (`ProjectionPlanner.effective`).
 *
 * Sort words (`"asc"`, Mongoose H18) are already `1`/`-1` in the plan. The four guards that walk the whole input
 * (undefined, sanitize, empty logical, limit) share one walk, `GuardScan.clean`; only when it finds something (or a
 * shape it does not follow) do the four run themselves, in their order, so which error is thrown and its text stay
 * the same.
 */
export class NormalizeStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "normalize";
  /** The guards that walk the input, in their order (run only when `GuardScan` finds something). */
  readonly #walking = [
    new UndefinedPolicy(),
    new SanitizePolicy(),
    new EmptyLogicalPolicy(),
    new LimitPolicy(),
  ] as const;
  readonly #emptyUpdate = new EmptyUpdatePolicy();
  readonly #requireFilter = new RequireFilterPolicy();

  /**
   * Runs the raw-input guards, then adds the discriminator and the effective projection.
   *
   * @param ctx - The context of the operation.
   * @throws {ConfigurationError} For `estimatedDocumentCount` of a discriminator model.
   * @throws {TypemoError} When a guard rejects the input.
   */
  run(ctx: OperationContext): void {
    if (!GuardScan.clean(ctx)) for (const guard of this.#walking) guard.run(ctx);
    this.#emptyUpdate.run(ctx);
    this.#requireFilter.run(ctx);
    const schema = OperationView.schema(ctx);
    const discriminator = schema.discriminator;
    if (discriminator !== undefined) {
      if (ctx.op === "estimatedDocumentCount") {
        throw new ConfigurationError(
          `estimatedDocumentCount of the discriminator ${schema.name} would count every document of the collection; use countDocuments`,
        );
      }
      OperationView.map(ctx, (unit) => NormalizeStep.discriminated(unit, discriminator.key, discriminator.value));
      if (ctx.op === "aggregate" && ctx.pipeline !== undefined) {
        ctx.pipeline = NormalizeStep.discriminatedPipeline(ctx.pipeline, discriminator.key, discriminator.value);
      }
    }
    if (PROJECTING.has(ctx.op)) ctx.projection = NormalizeStep.projection(schema, ctx.projection);
  }

  /**
   * The effective projection. Without a projection of the user it depends on the schema only (its hidden
   * fields, fixed when it is compiled): computed once per schema (the value is frozen).
   *
   * A `+path` key is checked here, against the schema, before it is resolved: in an exclusion projection a
   * `+path` only keeps a hidden field in, so it leaves no key of its own for the strict path check to see, and
   * an unknown `+path` would otherwise be dropped without a word. A `+path` of a field that is not Hidden is refused
   * for the same reason: it would change nothing.
   *
   * @param schema - The compiled schema.
   * @param projection - The user's projection, if any.
   * @returns The effective projection, or `undefined` when everything is loaded.
   * @throws {StrictModeError} With rule `unknown-path` when a `+path` is not a path of the schema, `not-hidden` when
   *   it is a path that is not Hidden.
   */
  static projection(schema: CompiledSchema, projection: PlanDocument | undefined): PlanDocument | undefined {
    if (projection !== undefined) {
      for (const key of Object.keys(projection)) {
        if (!key.startsWith("+")) continue;
        const path = key.slice(1);
        StrictPathPolicy.check(schema, path, "read", `projection.${key}`);
        /* "+path" adds a Hidden field back; on any other field it would silently do nothing. */
        if (!ProjectionPlanner.hiddenPaths(schema).some((hidden) => path === hidden || path.startsWith(`${hidden}.`))) {
          throw PolicyErrors.strict(
            "not-hidden",
            `projection: "${key}" adds a Hidden field back, and "${path}" is not Hidden; select it without the "+"`,
            `projection.${key}`,
          );
        }
      }
      return ProjectionPlanner.effective(schema, projection);
    }
    const cached = DEFAULT_PROJECTION.get(schema);
    if (cached !== undefined) return cached.value;
    const value = ProjectionPlanner.effective(schema, undefined);
    DEFAULT_PROJECTION.set(schema, { value });
    return value;
  }

  /**
   * A filter restricted to one discriminator value (the user's own condition on the key is kept, ANDed).
   *
   * @param filter - The filter.
   * @param key - The discriminator key.
   * @param value - The discriminator value.
   * @returns The restricted filter.
   */
  static discriminatorFilter(filter: PlanDocument, key: string, value: string): PlanDocument {
    if (!Object.hasOwn(filter, key)) {
      const out: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(filter))
        Object.defineProperty(out, name, { value: item, enumerable: true, writable: true, configurable: true });
      out[key] = value;
      return Object.freeze(out);
    }
    if (filter[key] === value) return filter;
    return Object.freeze({ $and: Object.freeze([filter, Object.freeze({ [key]: value })]) });
  }

  /**
   * Restricts the filter of a unit to the discriminator value.
   *
   * @param unit - The unit of work.
   * @param key - The discriminator key.
   * @param value - The discriminator value.
   * @returns The unit with the restricted filter.
   */
  private static discriminated(unit: WorkUnit, key: string, value: string): WorkUnit {
    return unit.filter === undefined
      ? unit
      : { ...unit, filter: NormalizeStep.discriminatorFilter(unit.filter, key, value) };
  }

  /**
   * An aggregation of a discriminator model: `$match` of its key first (after a first-only stage).
   *
   * @param stages - The stages.
   * @param key - The discriminator key.
   * @param value - The discriminator value.
   * @returns The stages with the `$match`.
   */
  static discriminatedPipeline(stages: readonly PipelineStage[], key: string, value: string): readonly PipelineStage[] {
    const [first, ...rest] = stages;
    const name = first === undefined ? undefined : Object.keys(first)[0];
    const match: PipelineStage = Object.freeze({ $match: Object.freeze({ [key]: value }) });
    if (first !== undefined && name === "$geoNear" && BsonGuards.isPlainObject(first.$geoNear)) {
      const spec = first.$geoNear;
      const query = BsonGuards.isPlainObject(spec.query) ? spec.query : {};
      return [
        Object.freeze({
          $geoNear: Object.freeze({ ...spec, query: NormalizeStep.discriminatorFilter(query, key, value) }),
        }),
        ...rest,
      ];
    }
    /* Not frozen: the context's list of stages; each stage is. */
    if (first !== undefined && name !== undefined && FIRST_ONLY.has(name)) return [first, match, ...rest];
    return [match, ...stages];
  }
}
