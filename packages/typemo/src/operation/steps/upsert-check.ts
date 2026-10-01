import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../../bson/bson-guards.ts";
import { type SchemaIssue, ValidationError } from "../../errors/validation-error.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import { DefaultsFiller } from "./defaults-filler.ts";

/*
 * An upsert inserts a document when nothing matches: the equality fields of the filter, then the update applied
 * to them. The validators of an update look at the written paths only, so a required field nobody gives would be
 * missing from the inserted document without any error (Mongoose inserted it). The document an insert would create
 * is therefore checked before anything is sent: every required field must be given — by an equality of the filter,
 * by `$set` or `$setOnInsert` (defaults are already there), or by any other operator that writes the path (its
 * result is a value). An embedded document that would be created from dotted paths is checked the same way.
 * Whether the upsert would insert is not known before it runs, so the check applies to every upsert; an update
 * without `upsert` is not affected.
 */

/** A path that is given as a whole: what is below it is not looked at. */
const GIVEN = Symbol("typemo.steps.upsertGiven");

/**
 * The fields an upsert gives, as a tree of field names.
 *
 * @example
 * const tree: GivenTree = new Map([["owner", GIVEN], ["place", new Map([["city", GIVEN]])]]);
 */
type GivenTree = Map<string, GivenTree | typeof GIVEN>;

/** Matches a path segment that is not a field name: `$`, `$[]`, `$[id]` or an index. */
const POSITIONAL = /^(?:\$(?:\[[A-Za-z0-9]*\])?|\d+)$/;

/**
 * The check of the document an upsert would insert.
 *
 * @example
 * UpsertCheck.update(schema, { title: "a" }, { $set: { tags: [] } }); // throws: "owner" is required
 */
export class UpsertCheck {
  /**
   * Checks an operator update with `upsert`.
   *
   * @param schema - The compiled schema.
   * @param filter - The cast filter, in code names.
   * @param update - The cast update with its defaults, in code names.
   * @throws {ValidationError} When the inserted document would lack a required field.
   */
  static update(schema: CompiledSchema, filter: PlanDocument | undefined, update: PlanDocument): void {
    const tree: GivenTree = new Map();
    for (const path of DefaultsFiller.equalityPaths(filter)) UpsertCheck.give(tree, path);
    for (const [operator, operand] of Object.entries(update)) {
      /* `$unset` gives nothing; a required path it names is refused by the validators. */
      if (operator === "$unset" || !BsonGuards.isPlainObject(operand)) continue;
      for (const [path, value] of Object.entries(operand)) {
        UpsertCheck.give(tree, operator === "$rename" && typeof value === "string" ? value : path);
      }
    }
    UpsertCheck.finish(schema, tree);
  }

  /**
   * Checks an update pipeline with `upsert`: the fields its `$set`/`$addFields` stages write are given.
   *
   * @param schema - The compiled schema.
   * @param filter - The cast filter, in code names.
   * @param stages - The stages with their defaults, in code names.
   * @throws {ValidationError} When the inserted document would lack a required field.
   */
  static pipeline(schema: CompiledSchema, filter: PlanDocument | undefined, stages: readonly PipelineStage[]): void {
    const tree: GivenTree = new Map();
    for (const path of DefaultsFiller.equalityPaths(filter)) UpsertCheck.give(tree, path);
    for (const stage of stages) {
      const spec = stage.$set ?? stage.$addFields;
      if (BsonGuards.isPlainObject(spec)) for (const path of Object.keys(spec)) UpsertCheck.give(tree, path);
      /* A stage that builds the whole document is checked by the pipeline guard; its fields are given. */
      const root =
        stage.$replaceWith ?? (BsonGuards.isPlainObject(stage.$replaceRoot) ? stage.$replaceRoot.newRoot : undefined);
      if (root !== undefined || stage.$project !== undefined) return;
    }
    UpsertCheck.finish(schema, tree);
  }

  /**
   * Marks a path as given. A path through a position or an index gives the field that holds the array.
   *
   * @param tree - The tree of given fields.
   * @param path - The dotted path in code names.
   */
  private static give(tree: GivenTree, path: string): void {
    const segments = path.split(".");
    let level = tree;
    for (const [index, segment] of segments.entries()) {
      const next = segments[index + 1];
      if (index === segments.length - 1 || (next !== undefined && POSITIONAL.test(next))) {
        level.set(segment, GIVEN);
        return;
      }
      const below = level.get(segment);
      if (below === GIVEN) return;
      if (below !== undefined) level = below;
      else {
        const created: GivenTree = new Map();
        level.set(segment, created);
        level = created;
      }
    }
  }

  /**
   * Throws when the tree lacks a required field.
   *
   * @param schema - The compiled schema.
   * @param tree - The tree of given fields.
   * @throws {ValidationError} With one issue per missing required field.
   */
  private static finish(schema: CompiledSchema, tree: GivenTree): void {
    const issues: SchemaIssue[] = [];
    UpsertCheck.missing(schema, tree, [], issues);
    if (issues.length > 0) throw new ValidationError(issues);
  }

  /**
   * Collects the required fields of `schema` the tree does not give; an embedded document given in parts is
   * checked in turn.
   *
   * @param schema - The compiled schema of the (embedded) document.
   * @param tree - The given fields at this level.
   * @param prefix - The path of the document.
   * @param issues - Receives the issues.
   */
  private static missing(
    schema: CompiledSchema,
    tree: GivenTree,
    prefix: readonly string[],
    issues: SchemaIssue[],
  ): void {
    for (const node of schema.fields) {
      /* Service fields (`_id`, timestamps, version, discriminator key) are filled by the core or the server. */
      if (node.service !== undefined) continue;
      const given = tree.get(node.key);
      const path = [...prefix, node.key];
      if (given === undefined) {
        if (!node.required) continue;
        issues.push({
          path,
          reason: "required",
          message: `upsert would create a document without the required field "${path.join(".")}"; give it in the filter (an equality), in $set or in $setOnInsert`,
          value: undefined,
        });
        continue;
      }
      if (given !== GIVEN && (node.kind === "subdocument" || node.kind === "nested"))
        UpsertCheck.missing(node.schema, given, path, issues);
    }
  }
}
