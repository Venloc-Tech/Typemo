import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { type PathMode, PathResolver } from "../operation/steps/path-resolver.ts";
import type { PlanDocument } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * A write of an immutable path is an error, except `$setOnInsert` (the only place an immutable
 * field is written by an update: it applies on insert only). Mongoose silently DROPPED such writes (also
 * with `strict: "throw"`), let `strict: false`, update pipelines and `$setOnInsert` bypass the rule, and
 * moved `$set` of immutable paths to `$setOnInsert` on upsert. Here a path is refused when it, an
 * ancestor, or a descendant reached through embedded documents (not through arrays/Maps: a new element
 * is a new value) is immutable.
 * `immutable` of `_id` binds the ROOT `_id` only: a subdocument's `_id` (from `Entity`) is
 * the element's identity, and replacing the element — a new `_id` included — is a normal write.
 * The discriminator key of a model is immutable too, whether declared or added by the core: it says which class a
 * stored document is, and a changed key leaves a document its class cannot read. An embedded discriminator's key
 * is not bound: replacing the subdocument (with another class) is a new value.
 *
 * Update pipelines: `$set`/`$addFields` keys and `$unset` paths are checked the same way; `$project`,
 * `$replaceRoot` and `$replaceWith` rewrite the whole document, so on a schema with immutable fields besides
 * `_id` (`Timestamped` has one: `createdAt`) they are refused UNLESS the new root carries every such field
 * unchanged — `createdAt: "$createdAt"` in the object of `$replaceWith`/`$replaceRoot`, the field included (`1`) in
 * an inclusion `$project` or not excluded from an exclusion one, or a `$mergeObjects` of `"$$ROOT"` with objects
 * that do not name an immutable field. Anything the policy cannot read as "unchanged" (another expression) is
 * refused, as before.
 */

/** The pipeline stages that rewrite the whole document. */
const WHOLE_DOCUMENT_STAGES: ReadonlySet<string> = new Set(["$project", "$replaceRoot", "$replaceWith"]);

/**
 * Where a schema has immutable paths, computed once per schema. `top`: the top-level fields that are immutable;
 * `deep`: an immutable path below the top level exists (a subdocument's `_id` excepted). Without deep ones a
 * written path is refused exactly when its first segment is in `top` — no resolution of every prefix.
 *
 * @example
 * const facts: ImmutableFacts = { top: new Set(["createdBy"]), deep: false };
 */
interface ImmutableFacts {
  /** The top-level immutable fields. */
  readonly top: ReadonlySet<string>;
  /** Whether an immutable path exists below the top level. */
  readonly deep: boolean;
}

/** The immutable facts of each schema, computed on its first write. */
const FACTS = new WeakMap<CompiledSchema, ImmutableFacts>();

/**
 * The immutable policy.
 *
 * @example
 * ImmutablePolicy.update(schema, { $set: { createdAt: new Date() } }); // throws StrictModeError (immutable)
 */
export class ImmutablePolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "immutable";

  /**
   * Checks the update of every unit of the operation.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `immutable` when an immutable path is written.
   */
  run(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    for (const unit of OperationView.units(ctx)) {
      if (unit.update === undefined) continue;
      if (Array.isArray(unit.update)) ImmutablePolicy.pipeline(schema, unit.update as readonly PipelineStage[]);
      else ImmutablePolicy.update(schema, unit.update as PlanDocument);
    }
  }

  /**
   * Throws at the first operator path (not `$setOnInsert`) that writes an immutable path.
   *
   * @param schema - The compiled schema.
   * @param update - The update document.
   * @throws {StrictModeError} With rule `immutable`.
   */
  static update(schema: CompiledSchema, update: PlanDocument): void {
    for (const [operator, operand] of Object.entries(update)) {
      if (operator === "$setOnInsert" || !BsonGuards.isPlainObject(operand)) continue;
      for (const [path, value] of Object.entries(operand)) {
        ImmutablePolicy.path(schema, path, "update", `${operator}.${path}`);
        if (operator === "$rename" && typeof value === "string")
          ImmutablePolicy.path(schema, value, "update", `${operator}.${path}`);
      }
    }
  }

  /**
   * An update pipeline: `$set`/`$addFields`/`$unset` paths are checked, whole-document stages are refused.
   *
   * @param schema - The compiled schema.
   * @param stages - The pipeline stages.
   * @throws {StrictModeError} With rule `immutable`.
   */
  static pipeline(schema: CompiledSchema, stages: readonly PipelineStage[]): void {
    stages.forEach((stage, index) => {
      for (const [name, spec] of Object.entries(stage)) {
        const at = `update.${index}.${name}`;
        if (name === "$set" || name === "$addFields") {
          if (BsonGuards.isPlainObject(spec))
            for (const key of Object.keys(spec)) ImmutablePolicy.path(schema, key, "read", `${at}.${key}`);
        } else if (name === "$unset") {
          const paths = typeof spec === "string" ? [spec] : Array.isArray(spec) ? spec : [];
          for (const path of paths) if (typeof path === "string") ImmutablePolicy.path(schema, path, "read", at);
        } else if (WHOLE_DOCUMENT_STAGES.has(name)) {
          const immutable = schema.fields
            .filter((field) => ImmutablePolicy.bound(field) && field.key !== "_id")
            .map((field) => field.key);
          if (immutable.length === 0) continue;
          const dropped = ImmutablePolicy.notCarried(name, spec, immutable);
          if (dropped.length > 0) {
            throw PolicyErrors.strict(
              "immutable",
              `${at}: ${name} rewrites the whole document and would change or drop the immutable fields ${dropped.join(", ")}; carry each unchanged (${dropped[0]}: "$${dropped[0]}") or use $set/$unset of the other fields`,
              at,
            );
          }
        }
      }
    });
  }

  /**
   * The immutable fields a whole-document stage does NOT visibly carry over unchanged.
   *
   * @param name - The stage name (`$project`, `$replaceRoot` or `$replaceWith`).
   * @param spec - The stage's argument.
   * @param keys - The immutable top-level fields of the schema (besides `_id`).
   * @returns The fields that may change or vanish; empty when every one is carried unchanged.
   */
  private static notCarried(name: string, spec: unknown, keys: readonly string[]): readonly string[] {
    if (name === "$project") return ImmutablePolicy.projectDrops(spec, keys);
    const root = name === "$replaceRoot" && BsonGuards.isPlainObject(spec) ? spec.newRoot : spec;
    if (root === "$$ROOT") return [];
    if (!BsonGuards.isPlainObject(root)) return keys;
    const operators = Object.keys(root).filter((key) => key.startsWith("$"));
    if (operators.length === 0) return keys.filter((key) => root[key] !== `$${key}`);
    /* `{ $mergeObjects: ["$$ROOT", { …literal fields… }] }`: everything is carried but the named fields. */
    const merged = operators.length === 1 && operators[0] === "$mergeObjects" ? root.$mergeObjects : undefined;
    if (!Array.isArray(merged) || merged[0] !== "$$ROOT") return keys;
    const named = new Set<string>();
    for (const part of merged.slice(1)) {
      if (!BsonGuards.isPlainObject(part) || Object.keys(part).some((key) => key.startsWith("$"))) return keys;
      for (const key of Object.keys(part)) named.add(key.split(".")[0] ?? key);
    }
    return keys.filter((key) => named.has(key));
  }

  /**
   * The immutable fields a `$project` of the whole update document would change or drop: in an inclusion each must
   * be included (`1`/`true`, or `"$field"`), in an exclusion none may be excluded, and `_id` must stay.
   *
   * @param spec - The `$project` argument.
   * @param keys - The immutable top-level fields of the schema (besides `_id`).
   * @returns The fields that may change or vanish.
   */
  private static projectDrops(spec: unknown, keys: readonly string[]): readonly string[] {
    if (!BsonGuards.isPlainObject(spec)) return keys;
    const falsy = (value: unknown): boolean => value === 0 || value === false;
    if (falsy(spec._id)) return keys;
    const entries = Object.entries(spec);
    const excluding = entries.some(([key, value]) => key !== "_id" && falsy(value));
    return keys.filter((key) => {
      const touched = entries.filter(([path]) => path === key || path.startsWith(`${key}.`));
      if (excluding) return touched.length > 0;
      return !touched.some(([path, value]) => path === key && (value === 1 || value === true || value === `$${key}`));
    });
  }

  /**
   * Throws when `path` (an ancestor, or an embedded descendant) is immutable.
   *
   * @param schema - The compiled schema.
   * @param path - The written path in code names.
   * @param mode - How the path is resolved.
   * @param at - Where the path sits, for the error.
   * @throws {StrictModeError} With rule `immutable`.
   */
  static path(schema: CompiledSchema, path: string, mode: PathMode, at: string): void {
    const facts = ImmutablePolicy.facts(schema);
    if (!facts.deep) {
      const dot = path.indexOf(".");
      const first = dot === -1 ? path : path.slice(0, dot);
      if (facts.top.has(first)) ImmutablePolicy.fail(at, first);
      return;
    }
    const segments = path.split(".");
    for (let length = 1; length <= segments.length; length++) {
      const prefix = segments.slice(0, length).join(".");
      const resolution = PathResolver.resolve(schema, prefix, mode);
      if (!resolution.ok) return;
      const node = resolution.value.node;
      if (node.immutable && !ImmutablePolicy.subdocumentId(segments, length)) ImmutablePolicy.fail(at, prefix);
      if (length === segments.length) {
        const inner = ImmutablePolicy.immutableDescendant(node, new Set());
        if (inner !== undefined) ImmutablePolicy.fail(at, `${prefix}.${inner}`);
      }
    }
  }

  /**
   * Whether a top-level field of a model cannot change once written: `immutable`, or the model's discriminator key.
   *
   * @param node - The top-level field node.
   * @returns `true` for a field written only when the document is created.
   */
  static bound(node: PathNode): boolean {
    return node.immutable || node.service === "discriminatorKey";
  }

  /**
   * The immutable paths of a schema, computed on its first write.
   *
   * @param schema - The compiled schema.
   * @returns The facts.
   */
  private static facts(schema: CompiledSchema): ImmutableFacts {
    const cached = FACTS.get(schema);
    if (cached !== undefined) return cached;
    const top = new Set<string>();
    const nodes: PathNode[] = [];
    /* The top-level fields as a path resolves them: the schema's own, then those of its discriminators. */
    for (const one of [schema, ...schema.discriminators.values()]) {
      for (const field of one.fields) {
        const node = PathResolver.field(schema, field.key);
        if (node === undefined) continue;
        if (ImmutablePolicy.bound(node)) top.add(field.key);
        nodes.push(node);
      }
    }
    const seen = new Set<CompiledSchema>([schema]);
    const deep = nodes.some((node) => ImmutablePolicy.below(node, seen));
    const facts: ImmutableFacts = Object.freeze({ top, deep });
    FACTS.set(schema, facts);
    return facts;
  }

  /**
   * `true` when a node reachable below `node` (elements, Map values, embedded fields) is immutable (not an `_id`).
   *
   * @param node - The path node.
   * @param seen - The schemas already visited (breaks cycles).
   * @returns Whether an immutable node exists below.
   */
  private static below(node: PathNode, seen: Set<CompiledSchema>): boolean {
    switch (node.kind) {
      case "array":
        return (node.element.immutable && node.element.key !== "_id") || ImmutablePolicy.below(node.element, seen);
      case "map":
        return (node.value.immutable && node.value.key !== "_id") || ImmutablePolicy.below(node.value, seen);
      case "subdocument":
      case "nested": {
        if (seen.has(node.schema)) return false;
        seen.add(node.schema);
        for (const one of [node.schema, ...node.schema.discriminators.values()]) {
          for (const field of one.fields) {
            if (field.immutable && field.key !== "_id") return true;
            if (ImmutablePolicy.below(field, seen)) return true;
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  /**
   * The path of an immutable field inside an embedded document, if any.
   *
   * @param node - The path node.
   * @param seen - The schemas already visited (breaks cycles).
   * @returns The relative path of the first immutable field, or `undefined`.
   */
  private static immutableDescendant(node: PathNode, seen: Set<CompiledSchema>): string | undefined {
    if (node.kind !== "subdocument" && node.kind !== "nested") return undefined;
    if (seen.has(node.schema)) return undefined;
    seen.add(node.schema);
    for (const field of node.schema.fields) {
      /* A subdocument's `_id` is not bound by `immutable` (only the root's is). */
      if (field.key === "_id") continue;
      if (field.immutable) return field.key;
      const inner = ImmutablePolicy.immutableDescendant(field, seen);
      if (inner !== undefined) return `${field.key}.${inner}`;
    }
    return undefined;
  }

  /**
   * Whether the prefix ends in the `_id` of a subdocument (any `_id` below the root).
   *
   * @param segments - The path segments.
   * @param length - How many segments the prefix has.
   * @returns `true` for an `_id` below the root.
   */
  private static subdocumentId(segments: readonly string[], length: number): boolean {
    return length > 1 && segments[length - 1] === "_id";
  }

  /**
   * Throws the error for a write of an immutable path.
   *
   * @param at - Where the path sits.
   * @param path - The immutable path.
   * @throws {StrictModeError} With rule `immutable`.
   */
  private static fail(at: string, path: string): never {
    throw PolicyErrors.strict(
      "immutable",
      `${at}: "${path}" is immutable; it is written only when the document is created ($setOnInsert on upsert)`,
      at,
    );
  }
}
