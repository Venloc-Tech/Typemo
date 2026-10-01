import { TransactionContext } from "../connection/transaction-context.ts";
import { Collections } from "../document/collections/collections.ts";
import { DocumentStates } from "../document/document-state.ts";
import { PopulatedFields } from "../document/populated-fields.ts";
import { QueryError } from "../errors/query-error.ts";
import { PolicyContext } from "../policies/policy-context.ts";
import { PopulateSpecs } from "../query/populate-specs.ts";
import { PopulateExecutor } from "./populate-executor.ts";

/**
 * Whether a populate record path is the wanted path, lies under it, or starts at its first segment.
 *
 * @param recordPath - The path of a populate record.
 * @param wanted - The path or field name asked for.
 * @returns `true` when the record belongs to `wanted`.
 */
const matches = (recordPath: string, wanted: string): boolean =>
  recordPath === wanted || recordPath.startsWith(`${wanted}.`) || recordPath.split(".")[0] === wanted;

/**
 * Populate methods of hydrated documents. `$populate(spec)` runs the same executor as a query (the target
 * models' pipelines, the document's session — explicit, else the ambient transaction's), `$populated(path)`
 * gives the stored ids behind a populated path, `$depopulate(key?)` puts them back. Populating a populated
 * path again first puts the ids back, then populates them: a second populate REPLACES the first one, whatever
 * it was (its select, match, nested paths), and never works on documents instead of ids (Mongoose's second
 * populate converted documents back and had lost the ids that found nothing, Mongoose M8 #1).
 *
 * @example
 * ```ts
 * await DocumentPopulate.populate(post, "author");
 * DocumentPopulate.populated(post, "author"); // the stored ObjectId
 * DocumentPopulate.depopulate(post, "author");
 * ```
 */
export class DocumentPopulate {
  /**
   * `$populate(spec)`: the string, object or list form of `populate()`.
   *
   * @param document - The hydrated document.
   * @param spec - The populate specification.
   * @returns The same document, populated.
   * @throws {QueryError} If `spec` is invalid.
   */
  static async populate(document: object, spec: unknown): Promise<object> {
    const state = DocumentStates.of(document);
    const plans = PopulateSpecs.normalize(spec);
    /* Re-populate replaces: the paths being populated again get their stored ids back first. */
    for (const plan of plans) DocumentPopulate.depopulate(document, plan.path);
    const ambient = TransactionContext.current();
    const session =
      state.session === null
        ? undefined
        : (state.session ??
          (ambient !== undefined && ambient.owner === state.connection.client ? ambient.session : undefined));
    await PopulateExecutor.populate([document], state.schema, plans, {
      connection: state.connection,
      session,
      sequential: session?.inTransaction() === true,
      lean: false,
      parent: undefined,
      options: Object.freeze(PolicyContext.captured()),
    });
    return document;
  }

  /**
   * `$populated(path)`: the stored ids behind a populated path — one value (an id, an array or a Map of ids)
   * for a field of the document, a list of them for a path inside subdocuments (one per subdocument, in
   * document order); `undefined` when the path is not populated. Copies: the document keeps its own.
   *
   * @param document - The hydrated document.
   * @param path - The populated path.
   * @returns The stored ids, or `undefined` when the path is not populated.
   */
  static populated(document: object, path: string): unknown {
    const sites = PopulatedFields.sites(document).filter((site) => site.record.path === path);
    if (sites.length === 0) return undefined;
    const originals = sites.map((site) => Collections.toPlain(site.record.original, { maps: "map" }));
    return sites.length === 1 && sites[0]?.owner === document ? originals[0] : originals;
  }

  /**
   * `$assertPopulated(path | { path } | [ … ])`: the document itself when every asserted path holds populated values,
   * otherwise a `QueryError` naming the first one that does not. A list asserts each element; an object also asserts
   * its nested `populate` paths (the type of the result says they are populated). A dotted path is checked through
   * the documents populated on its way (`author.company`: `author` populated, and `company` populated on every
   * author document found); a path inside subdocuments is checked as `$populated` sees it (the record of the whole
   * path).
   *
   * @param document - The hydrated document.
   * @param spec - A path string, an object with a `path`, or a list of them.
   * @returns The same document.
   * @throws {QueryError} If an element has no path or a path is not populated.
   */
  static assertPopulated(document: object, spec: unknown): object {
    const paths = DocumentPopulate.assertedPaths(spec, "");
    for (const path of paths) {
      const missing = DocumentPopulate.missing(document, path);
      if (missing === undefined) continue;
      const name = DocumentStates.of(document).schema.name;
      throw new QueryError(
        `$assertPopulated: "${missing}" of ${name} is not populated${missing === path ? "" : ` (asserting "${path}")`} — populate it first`,
        { path: missing },
      );
    }
    return document;
  }

  /**
   * The paths an `$assertPopulated` argument asserts: a string, an object's `path` and its nested `populate`
   * (prefixed), every element of a list.
   *
   * @param spec - The argument (or a nested part of it).
   * @param prefix - The path of the enclosing object, with its trailing dot.
   * @returns The paths, in order.
   * @throws {QueryError} If an element is not a path, an object with a `path` or a list (an empty list included).
   */
  private static assertedPaths(spec: unknown, prefix: string): string[] {
    if (typeof spec === "string" && spec !== "") return [`${prefix}${spec}`];
    if (Array.isArray(spec) && spec.length > 0) {
      return spec.flatMap((element: unknown) => DocumentPopulate.assertedPaths(element, prefix));
    }
    if (typeof spec === "object" && spec !== null && !Array.isArray(spec)) {
      const { path, populate } = spec as { readonly path?: unknown; readonly populate?: unknown };
      if (typeof path === "string" && path !== "") {
        const own = `${prefix}${path}`;
        return populate === undefined ? [own] : [own, ...DocumentPopulate.assertedPaths(populate, `${own}.`)];
      }
    }
    throw new QueryError("$assertPopulated: a populate path, { path }, or a list of them");
  }

  /**
   * The first part of `path` that is not populated under `document`.
   *
   * @param document - The document to inspect.
   * @param path - The path to check.
   * @param prefix - The path of `document` from the document the populate started at.
   * @returns The missing path, `undefined` when all of it is populated.
   */
  private static missing(document: object, path: string, prefix = ""): string | undefined {
    /* A nested populate records its path from the document the populate started at (`mentor.company` on the
     * mentor), a `$populate` of the populated document itself its own path (`company`): either counts. */
    const full = `${prefix}${path}`;
    if (PopulatedFields.sites(document).some((site) => site.record.path === path || site.record.path === full)) {
      return undefined;
    }
    const segments = path.split(".");
    /* The longest populated head: its documents must have the rest populated. */
    for (let cut = segments.length - 1; cut > 0; cut--) {
      const head = segments.slice(0, cut).join(".");
      const sites = PopulatedFields.sites(document).filter(
        (site) => site.record.path === head || site.record.path === `${prefix}${head}`,
      );
      if (sites.length === 0) continue;
      const rest = segments.slice(cut).join(".");
      for (const site of sites) {
        const value = site.record.value;
        const documents = Array.isArray(value) ? value : value instanceof Map ? [...value.values()] : [value];
        for (const item of documents) {
          if (item === null || item === undefined || !DocumentStates.is(item)) continue;
          const inner = DocumentPopulate.missing(item, rest, `${prefix}${head}.`);
          if (inner !== undefined) return inner;
        }
      }
      return undefined;
    }
    return `${prefix}${path}`;
  }

  /**
   * `$depopulate(key?)`: the stored ids back in place of the populated values — of every populated path, or
   * of those under `key` (a field of the document, or a populate path).
   *
   * @param document - The hydrated document.
   * @param key - A field name or populate path; omitted for every populated path.
   * @returns The same document.
   * @throws {QueryError} If `key` is not a string.
   */
  static depopulate(document: object, key?: string): object {
    if (key !== undefined && typeof key !== "string")
      throw new QueryError("$depopulate: a field name or a populate path");
    for (const site of PopulatedFields.sites(document)) {
      if (key !== undefined && !matches(site.record.path, key)) continue;
      PopulatedFields.restore(site.owner, site.key);
    }
    return document;
  }
}
