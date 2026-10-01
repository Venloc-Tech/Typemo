import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { ValueEquality } from "../document/collections/value-equality.ts";
import { StrictModeError } from "../errors/strict-mode-error.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView, type WorkUnit } from "../operation/steps/operation-view.ts";
import type { PlanDocument } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { SchemaWalker } from "../schema/compiler/schema-walker.ts";
import { PolicyContext, type PolicyValues } from "./policy-context.ts";
import { ScopeFilters } from "./scope-filters.ts";

/*
 * The tenant policy (off unless `@Schema({ tenant })`): every operation of a tenant-scoped
 * model works on the documents of ONE tenant — the operation's `ctx.policy.tenant` (the ambient scope when
 * it was built, or `.policy({ tenant })`), cast by the tenant field's type. Paths, all of them:
 * - filters of find/findOne/count/distinct/every write/findOneAnd*, cursors and explain: the tenant is
 *   ADDED to the user's filter (never replaces a user condition; `$and` when the user filters by the field);
 * - `estimatedDocumentCount` reads the collection's metadata and cannot be scoped: an error that points to
 *   `countDocuments()` (chosen over silently turning it into a scan: no silent behaviour);
 * - inserts (`insertOne`/`insertMany`/`create`/`save` of a new document, `bulkWrite.insertOne`) and
 *   replacements: the tenant field is SET when absent; another tenant's value is an error — a replacement
 *   never loses the field;
 * - updates may not write the tenant field (`$set`/`$setOnInsert` of the same tenant excepted); an update
 *   pipeline cannot write it, nor rewrite the whole document (`$project`/`$replaceRoot`/`$replaceWith`);
 * - aggregations: `$match` at the start; `$lookup`/`$unionWith`/`$graphLookup` of a tenant-scoped model get
 *   ITS tenant condition (also when the aggregated model itself is not scoped), at any depth; `$out`/`$merge`
 *   into a tenant-scoped collection are refused (they would write across tenants);
 * - populate: its sub-queries are operations of the target model, so they are scoped the same way (they
 *   inherit the parent's context);
 * - change streams (`watch`): refused — a delete event carries no document to scope by.
 * No tenant (and no explicit `allTenants: true` for cross-tenant work) is an error before anything is sent.
 */

/**
 * The tenant policy.
 *
 * @example
 * const node = TenantPolicy.fieldOf(schema); // the `tenantId` field, or `undefined` for an unscoped model
 */
export class TenantPolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "tenant";

  /**
   * The tenant field of a schema (its root's `tenant` option), `undefined` when the model is not scoped.
   *
   * @param schema - The compiled schema, if any.
   * @returns The field's node, or `undefined`.
   */
  static fieldOf(schema: CompiledSchema | undefined): PathNode | undefined {
    if (schema === undefined) return undefined;
    const option = schema.root.options.tenant;
    if (option === undefined) return undefined;
    const key = option === true ? "tenantId" : (option.field ?? "tenantId");
    return schema.field(key) ?? schema.root.field(key);
  }

  /**
   * The tenant a NEW document of `schema` gets from a policy context (`save` of a new document stamps it
   * before its validation): `undefined` when the model is not scoped or for cross-tenant work; no tenant
   * is the policy's error.
   *
   * @param schema - The compiled schema.
   * @param policy - The operation's policy context.
   * @param where - The call name, for the error.
   * @returns The tenant field's key and its cast value, or `undefined`.
   * @throws {StrictModeError} With rule `tenant` when the model is scoped and the context has no tenant.
   */
  static forNewDocument(
    schema: CompiledSchema,
    policy: Readonly<PolicyValues>,
    where: string,
  ): { readonly key: string; readonly value: unknown } | undefined {
    const node = TenantPolicy.fieldOf(schema);
    if (node === undefined || policy.allTenants === true) return undefined;
    if (policy.tenant === undefined) {
      throw TenantPolicy.error(
        `${where}: ${schema.name} is scoped by tenant ("${node.path}") and the operation has no tenant; ${TenantPolicy.hint("options")}`,
      );
    }
    return { key: node.key, value: SchemaWalker.castValue(node, policy.tenant, node.path) };
  }

  /**
   * Scopes the operation to its tenant, or refuses it.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `tenant` when there is no tenant, or the operation cannot be scoped.
   */
  run(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    const node = TenantPolicy.fieldOf(schema);
    if (ctx.op === "aggregate" && ctx.pipeline !== undefined) {
      ctx.pipeline = ScopeFilters.pipeline(
        ctx.pipeline,
        node === undefined ? undefined : TenantPolicy.condition(ctx, schema, node),
        (collection) => TenantPolicy.joined(ctx, collection),
        (collection, stage) => TenantPolicy.checkTarget(ctx, collection, stage),
      );
      return;
    }
    if (node === undefined) return;
    if (ctx.policy.allTenants === true) {
      /* Cross-tenant work still writes a tenant, never an empty one. */
      for (const unit of OperationView.units(ctx)) TenantPolicy.checkWritten(unit, node, TenantPolicy.where(ctx));
      return;
    }
    const where = TenantPolicy.where(ctx);
    if (ctx.op === "watch") {
      throw TenantPolicy.error(
        `${where}: a change stream of a tenant-scoped model cannot be scoped (a delete event has no document); watch inside PolicyContext.run({ allTenants: true }, () => ${ctx.target.entity.name}.watch()) and filter the events yourself`,
      );
    }
    if (ctx.op === "estimatedDocumentCount") {
      throw TenantPolicy.error(
        `${where}: estimatedDocumentCount reads the collection's metadata and would count every tenant; use countDocuments() (scoped by the tenant)`,
      );
    }
    /* Nothing to scope (an empty insertMany/bulkWrite). */
    if (OperationView.units(ctx).length === 0) return;
    const tenant = TenantPolicy.value(ctx, schema, node);
    OperationView.map(ctx, (unit) => TenantPolicy.unit(unit, node, tenant, where));
  }

  /**
   * `{ <field>: <tenant> }` of the operation for a schema.
   *
   * @param ctx - The operation context.
   * @param schema - The compiled schema.
   * @param node - The tenant field.
   * @returns The condition, or `undefined` for cross-tenant work.
   * @throws {StrictModeError} With rule `tenant` when the operation has no tenant.
   */
  private static condition(ctx: OperationContext, schema: CompiledSchema, node: PathNode): PlanDocument | undefined {
    if (ctx.policy.allTenants === true) return undefined;
    return Object.freeze({ [node.path]: TenantPolicy.value(ctx, schema, node) });
  }

  /**
   * The condition of a joined collection (its model's tenant field), `undefined` when it is not scoped.
   *
   * @param ctx - The operation context.
   * @param collection - The joined collection.
   * @returns The condition, or `undefined`.
   * @throws {StrictModeError} With rule `tenant` when the operation has no tenant.
   */
  private static joined(ctx: OperationContext, collection: string): PlanDocument | undefined {
    const schema = OperationView.schemaOfCollection(ctx, collection);
    const node = TenantPolicy.fieldOf(schema);
    return node === undefined || schema === undefined ? undefined : TenantPolicy.condition(ctx, schema, node);
  }

  /**
   * Refuses `$out`/`$merge` into a tenant-scoped collection (it would write across tenants).
   *
   * @param ctx - The operation context.
   * @param collection - The target collection.
   * @param stage - `$out` or `$merge`.
   * @throws {StrictModeError} With rule `tenant` when the target collection is tenant-scoped.
   */
  private static checkTarget(ctx: OperationContext, collection: string, stage: string): void {
    if (ctx.policy.allTenants === true) return;
    if (TenantPolicy.fieldOf(OperationView.schemaOfCollection(ctx, collection)) === undefined) return;
    throw TenantPolicy.error(
      `${TenantPolicy.where(ctx)}: ${stage} into "${collection}", a tenant-scoped collection, would write across tenants; write through the model instead (or allTenants: true)`,
    );
  }

  /**
   * The operation's tenant, cast by the tenant field (a missing tenant is an error).
   *
   * @param ctx - The operation context.
   * @param schema - The compiled schema.
   * @param node - The tenant field.
   * @returns The cast tenant.
   * @throws {StrictModeError} With rule `tenant` when the operation has no tenant.
   */
  private static value(ctx: OperationContext, schema: CompiledSchema, node: PathNode): unknown {
    const tenant = ctx.policy.tenant;
    if (tenant === undefined) {
      throw TenantPolicy.error(
        `${TenantPolicy.where(ctx)}: ${schema.name} is scoped by tenant ("${node.path}") and the operation has no tenant; ${TenantPolicy.hint(TenantPolicy.placeOf(ctx.op))}`,
      );
    }
    return SchemaWalker.castValue(node, tenant, node.path);
  }

  /**
   * One work unit scoped to the tenant: the filter conditioned, the update checked, the documents stamped.
   *
   * @param unit - The unit.
   * @param node - The tenant field.
   * @param tenant - The cast tenant.
   * @param where - The call name, for errors.
   * @returns The scoped unit.
   * @throws {StrictModeError} With rule `tenant` when the unit would touch another tenant.
   */
  private static unit(unit: WorkUnit, node: PathNode, tenant: unknown, where: string): WorkUnit {
    let out = unit;
    if (unit.filter !== undefined) out = { ...out, filter: ScopeFilters.filter(unit.filter, { [node.path]: tenant }) };
    if (unit.update !== undefined) TenantPolicy.checkUpdate(unit.update, node, tenant, where);
    if (unit.replacement !== undefined)
      out = { ...out, replacement: TenantPolicy.stamp(unit.replacement, node, tenant, where) };
    if (unit.document !== undefined) out = { ...out, document: TenantPolicy.stamp(unit.document, node, tenant, where) };
    return out;
  }

  /**
   * Refuses a unit of cross-tenant work that writes an empty tenant (a document, a replacement, `$set`).
   *
   * @param unit - The unit.
   * @param node - The tenant field.
   * @param where - The call name, for errors.
   * @throws {StrictModeError} With rule `tenant` when the tenant written is `null`, empty or whitespace only.
   */
  private static checkWritten(unit: WorkUnit, node: PathNode, where: string): void {
    const written: unknown[] = [];
    for (const document of [unit.document, unit.replacement]) {
      if (document !== undefined && Object.hasOwn(document, node.path)) written.push(document[node.path]);
    }
    const update = unit.update;
    if (update !== undefined && !Array.isArray(update)) {
      for (const operator of ["$set", "$setOnInsert"]) {
        const operand = (update as PlanDocument)[operator];
        if (BsonGuards.isPlainObject(operand) && Object.hasOwn(operand, node.path)) written.push(operand[node.path]);
      }
    }
    if (written.some((value) => PolicyContext.blankTenant(value))) {
      throw TenantPolicy.error(
        `${where}: the tenant written to "${node.path}" is empty; a tenant is a non-empty value`,
        node.path,
      );
    }
  }

  /**
   * A document with the tenant set (absent → the operation's; another tenant → error).
   *
   * @param document - The document.
   * @param node - The tenant field.
   * @param tenant - The cast tenant.
   * @param where - The call name, for errors.
   * @returns The document with the tenant field set.
   * @throws {StrictModeError} With rule `tenant` when the document is for another tenant.
   */
  private static stamp(document: PlanDocument, node: PathNode, tenant: unknown, where: string): PlanDocument {
    const current = document[node.path];
    if (current === undefined) return Object.freeze({ ...document, [node.path]: tenant });
    if (!ValueEquality.equals(current, tenant)) {
      throw TenantPolicy.error(
        `${where}: the document is for another tenant (${node.path}: ${String(current)}) than the operation's (${String(tenant)})`,
        node.path,
      );
    }
    return document;
  }

  /**
   * An update may not move a document to another tenant (nor lose the field).
   *
   * @param update - The update document or pipeline.
   * @param node - The tenant field.
   * @param tenant - The cast tenant.
   * @param where - The call name, for errors.
   * @throws {StrictModeError} With rule `tenant` when the update writes the tenant field with anything but the
   * operation's tenant, or a pipeline rewrites the whole document.
   */
  private static checkUpdate(
    update: PlanDocument | readonly PlanDocument[],
    node: PathNode,
    tenant: unknown,
    where: string,
  ): void {
    const field = node.path;
    const touches = (path: string): boolean =>
      path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`);
    if (Array.isArray(update)) {
      for (const stage of update as readonly PipelineStage[]) {
        for (const [name, spec] of Object.entries(stage)) {
          const keys =
            name === "$set" || name === "$addFields"
              ? BsonGuards.isPlainObject(spec)
                ? Object.keys(spec)
                : []
              : name === "$unset"
                ? (typeof spec === "string" ? [spec] : Array.isArray(spec) ? spec : []).filter(
                    (path): path is string => typeof path === "string",
                  )
                : [];
          if (name === "$project" || name === "$replaceRoot" || name === "$replaceWith") {
            throw TenantPolicy.error(
              `${where}: an update pipeline with ${name} rewrites the whole document and could lose or change the tenant field "${field}"`,
              field,
            );
          }
          const hit = keys.find(touches);
          if (hit !== undefined) {
            throw TenantPolicy.error(`${where}: an update pipeline may not write the tenant field ("${hit}")`, hit);
          }
        }
      }
      return;
    }
    for (const [operator, operand] of Object.entries(update as PlanDocument)) {
      if (!BsonGuards.isPlainObject(operand)) continue;
      for (const [path, value] of Object.entries(operand)) {
        const target = operator === "$rename" && typeof value === "string" ? value : undefined;
        const hit = touches(path) ? path : target !== undefined && touches(target) ? target : undefined;
        if (hit === undefined) continue;
        const same = (operator === "$set" || operator === "$setOnInsert") && path === field;
        if (same && ValueEquality.equals(value, tenant)) continue;
        throw TenantPolicy.error(
          `${where}: ${operator} of the tenant field ("${hit}") would move the document to another tenant or lose it`,
          hit,
        );
      }
    }
  }

  /**
   * Where an operation takes its policy: a query builder (`.policy(...)`), the options of a direct write, or only
   * the ambient scope (a change stream).
   *
   * @param op - The operation name.
   * @returns The place.
   */
  private static placeOf(op: string): "builder" | "options" | "scope" {
    if (op === "insertOne" || op === "insertMany" || op === "bulkWrite") return "options";
    return op === "watch" ? "scope" : "builder";
  }

  /**
   * How the call that has no tenant can get one, in the form the call really takes: a query builder has
   * `.policy(...)`, a direct write (`create`, `insertOne`, `insertMany`, `bulkWrite`, `$save`) takes `policy` in its
   * options, a change stream only the ambient scope.
   *
   * @param place - Where the call takes a policy.
   * @returns The hint of the error text.
   */
  private static hint(place: "builder" | "options" | "scope"): string {
    const scope = "run it inside PolicyContext.run({ tenant }, …)";
    switch (place) {
      case "builder":
        return `${scope} or add .policy({ tenant }) to the query (cross-tenant work: .policy({ allTenants: true }))`;
      case "options":
        return `${scope} or pass { policy: { tenant } } in the call's options (cross-tenant work: { policy: { allTenants: true } })`;
      default:
        return `${scope} (cross-tenant work: PolicyContext.run({ allTenants: true }, …))`;
    }
  }

  /**
   * The call name used in messages: `Model.operation`.
   *
   * @param ctx - The operation context.
   * @returns The name.
   */
  private static where(ctx: OperationContext): string {
    return OperationView.where(ctx);
  }

  /**
   * The policy's error.
   *
   * @param message - The message.
   * @param path - The path concerned, if any.
   * @returns A `StrictModeError` with rule `tenant`.
   */
  private static error(message: string, path?: string): StrictModeError {
    return new StrictModeError("tenant", message, path === undefined ? {} : { path });
  }
}
