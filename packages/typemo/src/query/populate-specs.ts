import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import type { PopulatePlan } from "./plan.ts";
import { PlanValues } from "./plan-values.ts";
import { ProjectionPlanner } from "./projection-planner.ts";
import { QuerySpecs } from "./query-specs.ts";

/*
 * The runtime twin of the populate types: the string, object and list forms become `PopulatePlan`s.
 * Paths are kept as written ("a.b.c" stays one path; the populate layer walks it). Unknown options
 * are errors, as in the type check.
 */

/** The keys a populate object may have. */
const KEYS = new Set([
  "path",
  "select",
  "match",
  "options",
  "populate",
  "justOne",
  "retainNullValues",
  "perDocumentLimit",
  "required",
  "clone",
  "transform",
]);
/** The keys the `options` of a populate object may have. */
const OPTION_KEYS = new Set(["sort", "limit", "skip"]);

/**
 * Normalizes populate arguments.
 *
 * @example
 * PopulateSpecs.normalize(["author", { path: "comments", select: { text: 1 } }]); // two PopulatePlans
 */
export class PopulateSpecs {
  /**
   * Every populate instruction of one `populate()` argument.
   *
   * @param spec - A path, a populate object, or a list of them.
   * @param where - Text appended to error messages to say where the spec sits (a nested populate).
   * @returns The plans, one per path.
   * @throws {QueryError} On an empty list, a path given twice, or an argument of another shape.
   */
  static normalize(spec: unknown, where = ""): readonly PopulatePlan[] {
    if (typeof spec === "string") return [PopulateSpecs.fromPath(spec, where)];
    if (Array.isArray(spec)) {
      if (spec.length === 0) throw new QueryError(`populate${where}: an empty list`);
      const plans = spec.flatMap((item: unknown) => PopulateSpecs.normalize(item, where));
      const seen = new Set<string>();
      for (const plan of plans) {
        /* Two instructions for one path in one call: which one wins would be a guess (the types join them). */
        if (seen.has(plan.path)) throw new QueryError(`populate${where}: the path "${plan.path}" is given twice`);
        seen.add(plan.path);
      }
      return plans;
    }
    if (BsonGuards.isPlainObject(spec)) return [PopulateSpecs.fromObject(spec, where)];
    throw new QueryError(`populate${where}: a path, an object with a path, or a list of them`);
  }

  /**
   * Replaces instructions for the same path (populating a path again replaces it, as the types say).
   *
   * @param previous - The instructions so far.
   * @param next - The instructions to add.
   * @returns The frozen list with `next` replacing any `previous` entry of the same path.
   */
  static replace(previous: readonly PopulatePlan[], next: readonly PopulatePlan[]): readonly PopulatePlan[] {
    const paths = new Set(next.map((entry) => entry.path));
    return Object.freeze([...previous.filter((entry) => !paths.has(entry.path)), ...next]);
  }

  /**
   * The plan of a plain string path.
   *
   * @param path - The populate path.
   * @param where - Text appended to error messages.
   * @returns The frozen plan.
   * @throws {QueryError} When the path is empty or has an empty segment.
   */
  private static fromPath(path: string, where: string): PopulatePlan {
    if (path === "" || path.startsWith(".") || path.endsWith(".") || path.includes("..")) {
      throw new QueryError(`populate${where}: invalid path "${path}"`, { path });
    }
    return Object.freeze({ path, populate: Object.freeze([]) });
  }

  /**
   * The plan of a populate object: every option is checked and copied.
   *
   * @param spec - The populate object.
   * @param where - Text appended to error messages.
   * @returns The frozen plan.
   * @throws {QueryError} On a missing path, an unknown option, or an option of the wrong type.
   */
  private static fromObject(spec: Readonly<Record<string, unknown>>, where: string): PopulatePlan {
    const { path } = spec;
    if (typeof path !== "string") throw new QueryError(`populate${where}: an object needs a string path`);
    const base = PopulateSpecs.fromPath(path, where);
    const unknown = Object.keys(spec).filter((key) => !KEYS.has(key));
    if (unknown.length > 0)
      throw new QueryError(`populate "${path}": unknown option "${unknown.join('", "')}"`, { path });
    const out: { -readonly [K in keyof PopulatePlan]: PopulatePlan[K] } = { path: base.path, populate: base.populate };
    if (spec.select !== undefined) {
      if (!BsonGuards.isPlainObject(spec.select))
        throw new QueryError(`populate "${path}": select is a projection object`, { path });
      out.select = ProjectionPlanner.check(spec.select);
    }
    if (typeof spec.match === "function") {
      out.matchFn = spec.match as (document: never) => unknown;
    } else if (spec.match !== undefined) {
      if (!BsonGuards.isPlainObject(spec.match))
        throw new QueryError(`populate "${path}": match is a filter object or a function of the document`, { path });
      out.match = PlanValues.filter(spec.match, `populate "${path}" match`);
    }
    if (spec.transform !== undefined) {
      if (typeof spec.transform !== "function")
        throw new QueryError(`populate "${path}": transform must be (doc, id) => value`, { path });
      out.transform = spec.transform as (doc: never, id: never) => unknown;
    }
    if (spec.options !== undefined) out.options = PopulateSpecs.options(spec.options, path);
    if (spec.perDocumentLimit !== undefined) {
      out.perDocumentLimit = QuerySpecs.limit(PopulateSpecs.number(spec.perDocumentLimit, "perDocumentLimit", path));
    }
    if (spec.justOne !== undefined) out.justOne = PopulateSpecs.flag(spec.justOne, "justOne", path);
    if (spec.retainNullValues !== undefined)
      out.retainNullValues = PopulateSpecs.flag(spec.retainNullValues, "retainNullValues", path);
    if (spec.required !== undefined) out.required = PopulateSpecs.flag(spec.required, "required", path);
    if (spec.clone !== undefined) out.clone = PopulateSpecs.flag(spec.clone, "clone", path);
    if (spec.populate !== undefined)
      out.populate = Object.freeze([...PopulateSpecs.normalize(spec.populate, ` "${path}"`)]);
    return Object.freeze(out);
  }

  /**
   * The `options` of a populate object: `sort`, `limit`, `skip`.
   *
   * @param options - The `options` value.
   * @param path - The populate path, for error messages.
   * @returns The frozen options.
   * @throws {QueryError} When `options` is not an object, has an unknown key, or a value is invalid.
   */
  private static options(options: unknown, path: string): NonNullable<PopulatePlan["options"]> {
    if (!BsonGuards.isPlainObject(options)) throw new QueryError(`populate "${path}": options is an object`, { path });
    const unknown = Object.keys(options).filter((key) => !OPTION_KEYS.has(key));
    if (unknown.length > 0)
      throw new QueryError(`populate "${path}": unknown option "${unknown.join('", "')}"`, { path });
    return Object.freeze({
      ...(options.sort === undefined ? {} : { sort: QuerySpecs.sort(options.sort) }),
      ...(options.limit === undefined
        ? {}
        : { limit: QuerySpecs.limit(PopulateSpecs.number(options.limit, "limit", path)) }),
      ...(options.skip === undefined
        ? {}
        : { skip: QuerySpecs.count("skip", PopulateSpecs.number(options.skip, "skip", path)) }),
    });
  }

  /**
   * Requires a number.
   *
   * @param value - The value.
   * @param name - The option name, for the error message.
   * @param path - The populate path, for the error message.
   * @returns `value`.
   * @throws {QueryError} When `value` is not a number.
   */
  private static number(value: unknown, name: string, path: string): number {
    if (typeof value !== "number") throw new QueryError(`populate "${path}": ${name} must be a number`, { path });
    return value;
  }

  /**
   * Requires a boolean.
   *
   * @param value - The value.
   * @param name - The option name, for the error message.
   * @param path - The populate path, for the error message.
   * @returns `value`.
   * @throws {QueryError} When `value` is not a boolean.
   */
  private static flag(value: unknown, name: string, path: string): boolean {
    if (typeof value !== "boolean") throw new QueryError(`populate "${path}": ${name} must be a boolean`, { path });
    return value;
  }
}
