import { QueryError } from "../errors/query-error.ts";
import type { PlanDocument, PopulatePlan, SortPair } from "../query/plan.ts";
import { QuerySpecs } from "../query/query-specs.ts";
import type { CompiledSchema, VirtualDefinition } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import type { VirtualOptions } from "../schema/options/virtual-options.ts";

/**
 * How the documents of a population are found: through a reference field, or through a populate virtual.
 *
 * @example
 * ```ts
 * const source: PopulationSource = { kind: "reference" };
 * ```
 */
export type PopulationSource =
  | { readonly kind: "reference" }
  | {
      readonly kind: "virtual";
      readonly virtual: string;
      readonly options: VirtualOptions;
    };

/**
 * One population of documents of one schema: for a populate path, where the references are (the owners
 * of the reference field and the field), what kind of reference it is, and the options with their
 * effective meaning.
 *
 * @example
 * ```ts
 * const [population] = PopulatePlanner.plan(schema, plans);
 * population?.owners; // ["lines"] for the path "lines.product"
 * ```
 */
export interface Population {
  /** The path as written from the documents' root (code names), e.g. `lines.product`, `refs.$*`. */
  readonly path: string;
  /** The segments from a document to the OWNERS of the field (`$*` enters Map values; arrays implicitly). */
  readonly owners: readonly string[];
  /** The key of the reference field (or of the virtual) on each owner. */
  readonly field: string;
  /** `true` when the field is a Map of references (`field.$*`). */
  readonly map: boolean;
  /** Whether the documents come from a reference field or a populate virtual. */
  readonly source: PopulationSource;
  /** `justOne` of the call (`undefined`: the field's own shape decides). */
  readonly justOne: boolean | undefined;
  /** A `count` virtual. */
  readonly count: boolean;
  /** The projection applied to the found documents. */
  readonly select: PlanDocument | undefined;
  /** The call's `match` (the virtual's own `match` is added by the executor with `$and`). */
  readonly match: PlanDocument | undefined;
  /** A function form of `match`, evaluated per owner document. */
  readonly matchFn: ((document: never) => unknown) | undefined;
  /** The sort of the found documents. */
  readonly sort: readonly SortPair[] | undefined;
  /** Documents skipped per owner. */
  readonly skip: number | undefined;
  /** At most this many documents per owner (`options.limit` or `perDocumentLimit`). */
  readonly limit: number | undefined;
  /** Keep a `null` in the position of a reference that found nothing. */
  readonly retainNullValues: boolean;
  /** A reference that finds nothing is an error. */
  readonly required: boolean;
  /** Each owner gets its own copy of a found document. */
  readonly clone: boolean;
  /** Maps a found document (and its id) to the value stored in its place. */
  readonly transform: ((doc: never, id: never) => unknown) | undefined;
  /** Nested populate of the target model (paths relative to it). */
  readonly populate: readonly PopulatePlan[];
}

/** What a populate path reaches in a schema. */
interface Reach {
  /** The path up to and including the reference (the population's path). */
  readonly path: string;
  /** The segments from the document to the owners of the reference field. */
  readonly owners: readonly string[];
  /** The key of the reference field or virtual. */
  readonly field: string;
  /** `true` for a Map of references. */
  readonly map: boolean;
  /** The populate virtual reached, if the path ends at one. */
  readonly virtual: VirtualDefinition | undefined;
  /** A single reference field (neither an array of references nor a Map of them, nor a virtual). */
  readonly single: boolean;
  /** A polymorphic reference (`refPath`, `refModel`). */
  readonly polymorphic: boolean;
  /** The rest of the path below the reference (`undefined` when the path ends at it). */
  readonly rest: string | undefined;
}

/** Planned populations per schema and per plan-list identity. */
const CACHE = new WeakMap<CompiledSchema, WeakMap<readonly PopulatePlan[], readonly Population[]>>();

/**
 * Whether a node carries a reference (`ref`, `refPath` or `refModel`).
 *
 * @param node - The path node.
 * @returns `true` for a reference.
 */
const isRef = (node: PathNode): boolean =>
  node.ref !== undefined || node.refPath !== undefined || node.refModel !== undefined;

/**
 * Unwraps arrays (a reference array's element carries the reference).
 *
 * @param node - The path node.
 * @returns The innermost non-array node.
 */
const elementOf = (node: PathNode): PathNode => (node.kind === "array" ? elementOf(node.element) : node);

/**
 * Plans the populate instructions of one schema. A pure function of the schema and the plans (no
 * document, no query): the executor walks the documents with its result.
 *
 * Paths are split at the FIRST reference reached from the document through embedded documents, arrays
 * and Maps: `lines.product` is one population (owners: the elements of `lines`, field `product`);
 * `author.company` is the population `author` with a NESTED population `company` of the author model;
 * `refs.$*` populates the values of a Map of references; `m.$*.owner` the field `owner` of a Map of
 * subdocuments. Instructions that reach the same reference are merged: the one naming it exactly gives
 * the options, the deeper ones become its nested populate (the types do the same: `ApplyPopulate`).
 *
 * Rules the planner enforces (a conflict is an error, never a guess):
 * - a path must lead to a reference (`ref`, `refPath`, `refModel`), a populate virtual or a Map of them;
 * - below a polymorphic reference (`refPath`, `refModel`) nothing can be populated (the target is not one model);
 * - `count` virtuals take no `select`, `sort`, `limit`, `skip`, `perDocumentLimit`, `transform`, `justOne`,
 *   `retainNullValues` or nested populate; `retainNullValues` keeps POSITIONS of a reference array, so it
 *   is refused with `sort` and on virtuals; `limit` and `perDocumentLimit` are the same per-document limit
 *   (one of them); a single reference takes no `sort`/`limit`/`skip`/`perDocumentLimit`.
 *
 * @example
 * ```ts
 * const populations = PopulatePlanner.plan(schema, [{ path: "lines.product", populate: [] }]);
 * ```
 */
export class PopulatePlanner {
  /**
   * The populations of `plans` on documents of `schema` (cached per schema and plan list).
   *
   * @param schema - The compiled schema of the documents.
   * @param plans - The populate instructions.
   * @param prefix - The path of `schema`'s documents from the root populate, used in error messages.
   * @returns The frozen list of populations.
   * @throws {QueryError} If a path is invalid, given twice, or its options conflict.
   */
  static plan(schema: CompiledSchema, plans: readonly PopulatePlan[], prefix = ""): readonly Population[] {
    let bySchema = CACHE.get(schema);
    if (bySchema === undefined) {
      bySchema = new WeakMap();
      CACHE.set(schema, bySchema);
    }
    const cached = bySchema.get(plans);
    if (cached !== undefined) return cached;
    const planned = PopulatePlanner.build(schema, plans, prefix);
    bySchema.set(plans, planned);
    return planned;
  }

  /**
   * Groups the plans by the reference they reach and builds one population per group.
   *
   * @param schema - The compiled schema.
   * @param plans - The populate instructions.
   * @param prefix - The path prefix for error messages.
   * @returns The populations.
   * @throws {QueryError} If a path is given twice or goes below a polymorphic reference.
   */
  private static build(schema: CompiledSchema, plans: readonly PopulatePlan[], prefix: string): readonly Population[] {
    const groups = new Map<string, { reach: Reach; exact: PopulatePlan | undefined; nested: PopulatePlan[] }>();
    for (const plan of plans) {
      const reach = PopulatePlanner.reach(schema, plan.path, prefix);
      let group = groups.get(reach.path);
      if (group === undefined) {
        group = { reach, exact: undefined, nested: [] };
        groups.set(reach.path, group);
      }
      if (reach.rest === undefined) {
        if (group.exact !== undefined) {
          throw new QueryError(`populate "${prefix}${plan.path}": the path is given twice`, { path: plan.path });
        }
        group.exact = plan;
        group.nested.push(...plan.populate);
      } else {
        if (reach.polymorphic) {
          throw new QueryError(
            `populate "${prefix}${plan.path}": "${prefix}${reach.path}" is a polymorphic reference (refPath/refModel); nothing below it can be populated`,
            { path: plan.path },
          );
        }
        /* The options of a deeper path belong to its last reference: it becomes a nested instruction. */
        group.nested.push(Object.freeze({ ...plan, path: reach.rest }));
      }
    }
    return Object.freeze(
      [...groups.values()].map((group) =>
        PopulatePlanner.population(group.reach, group.exact, Object.freeze(group.nested), prefix),
      ),
    );
  }

  /**
   * Walks `path` in `schema` (discriminators included) to the first reference.
   *
   * @param schema - The compiled schema.
   * @param path - The populate path.
   * @param prefix - The path prefix for error messages.
   * @returns What the path reaches.
   * @throws {QueryError} If the path does not lead to a reference or virtual.
   */
  private static reach(schema: CompiledSchema, path: string, prefix: string): Reach {
    const segments = path.split(".");
    const owners: string[] = [];
    let current: readonly CompiledSchema[] = PopulatePlanner.variants(schema);
    const fail = (why: string): never => {
      throw new QueryError(`populate "${prefix}${path}": ${why}`, { path });
    };
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index] as string;
      const here = segments.slice(0, index + 1).join(".");
      const rest = index + 1 < segments.length ? segments.slice(index + 1).join(".") : undefined;
      const virtual = current
        .flatMap((one) => one.virtuals)
        .find((one) => one.kind === "populate" && one.key === segment);
      if (virtual !== undefined) {
        return { path: here, owners, field: segment, map: false, virtual, single: false, polymorphic: false, rest };
      }
      const nodes = current.map((one) => one.field(segment)).filter((node): node is PathNode => node !== undefined);
      const node = nodes[0];
      if (node === undefined)
        return fail(`"${segment}" is not a field of ${current.map((one) => one.name).join(" | ")}`);
      const element = elementOf(node);
      if (isRef(element)) {
        return {
          path: here,
          owners,
          field: segment,
          map: false,
          virtual: undefined,
          single: node.kind !== "array",
          polymorphic: element.ref === undefined,
          rest,
        };
      }
      if (element.kind === "map") {
        if (segments[index + 1] !== "$*") return fail(`"${segment}" is a Map: its values are "${segment}.$*"`);
        const value = elementOf(element.value);
        if (isRef(value)) {
          const after = index + 2 < segments.length ? segments.slice(index + 2).join(".") : undefined;
          return {
            path: `${here}.$*`,
            owners,
            field: segment,
            map: true,
            virtual: undefined,
            single: false,
            polymorphic: value.ref === undefined,
            rest: after,
          };
        }
        if (value.kind !== "subdocument" && value.kind !== "nested") {
          return fail(`the values of the Map "${segment}" are neither references nor embedded documents`);
        }
        owners.push(segment, "$*");
        current = PopulatePlanner.variants(value.schema);
        index++;
        continue;
      }
      if (element.kind === "subdocument" || element.kind === "nested") {
        owners.push(segment);
        current = [...new Set(nodes.flatMap((one) => PopulatePlanner.variants(PopulatePlanner.schemaOf(one))))];
        continue;
      }
      return fail(`"${segment}" is neither a reference nor an embedded document`);
    }
    return fail("the path ends at an embedded document, not at a reference");
  }

  /**
   * The schema of an embedded node.
   *
   * @param node - A subdocument or nested node (possibly wrapped in arrays).
   * @returns Its schema.
   * @throws {QueryError} If the node is not embedded (an internal error).
   */
  private static schemaOf(node: PathNode): CompiledSchema {
    const element = elementOf(node);
    if (element.kind !== "subdocument" && element.kind !== "nested")
      throw new QueryError("Internal error: not embedded");
    return element.schema;
  }

  /**
   * A schema and its discriminators (a field may exist on one of them only: Mongoose H011).
   *
   * @param schema - The compiled schema.
   * @returns The schema followed by its discriminator schemas.
   */
  private static variants(schema: CompiledSchema): readonly CompiledSchema[] {
    return schema.discriminators.size === 0 ? [schema] : [schema, ...schema.discriminators.values()];
  }

  /**
   * Builds one population and validates its options.
   *
   * @param reach - What the path reaches.
   * @param exact - The instruction naming the reference exactly, if any.
   * @param nested - The nested instructions for the target model.
   * @param prefix - The path prefix for error messages.
   * @returns The frozen population.
   * @throws {QueryError} If the options conflict (count virtual options, `retainNullValues` with `sort`, `sort`/`limit`/`skip`/`perDocumentLimit` on a single reference, …).
   */
  private static population(
    reach: Reach,
    exact: PopulatePlan | undefined,
    nested: readonly PopulatePlan[],
    prefix: string,
  ): Population {
    const where = `populate "${prefix}${reach.path}"`;
    const options = exact?.options;
    const virtualOptions = reach.virtual?.kind === "populate" ? reach.virtual.options : undefined;
    const count = virtualOptions?.count === true;
    if (exact?.options?.limit !== undefined && exact.perDocumentLimit !== undefined) {
      throw new QueryError(
        `${where}: "options.limit" and "perDocumentLimit" are the same per-document limit; give one`,
      );
    }
    const limit = exact?.perDocumentLimit ?? options?.limit ?? (exact === undefined ? undefined : undefined);
    const conflict = (what: string): never => {
      throw new QueryError(`${where}: ${what}`, { path: reach.path });
    };
    if (count) {
      const given = [
        exact?.select === undefined ? "" : "select",
        options?.sort === undefined ? "" : "sort",
        limit === undefined ? "" : "limit",
        options?.skip === undefined ? "" : "skip",
        exact?.transform === undefined ? "" : "transform",
        exact?.justOne === undefined ? "" : "justOne",
        exact?.retainNullValues === undefined ? "" : "retainNullValues",
        exact?.required === undefined ? "" : "required",
        exact?.clone === undefined ? "" : "clone",
        nested.length === 0 ? "" : "populate",
      ].filter((name) => name !== "");
      if (given.length > 0) conflict(`a count virtual takes no ${given.join(", ")} (it gives a number)`);
    }
    if (exact?.retainNullValues === true) {
      if (reach.virtual !== undefined)
        conflict("retainNullValues keeps the positions of a reference array; a virtual has none");
      if (options?.sort !== undefined)
        conflict("retainNullValues keeps positions, sort reorders: they cannot be combined");
    }
    if (reach.map && exact?.justOne !== undefined) conflict("justOne does not apply to the values of a Map");
    if (reach.single) {
      /* One owner holds one document at most: sort, limit, skip and a per-document limit would have nothing to
       * act on. */
      const given = [
        options?.sort === undefined ? "" : "sort",
        options?.limit === undefined ? "" : "limit",
        options?.skip === undefined ? "" : "skip",
        exact?.perDocumentLimit === undefined ? "" : "perDocumentLimit",
      ].filter((name) => name !== "");
      if (given.length > 0) {
        conflict(`a single reference holds one document; options ${given.join(", ")} apply to reference arrays only`);
      }
    }
    return Object.freeze({
      path: reach.path,
      owners: Object.freeze([...reach.owners]),
      field: reach.field,
      map: reach.map,
      source:
        reach.virtual?.kind === "populate"
          ? Object.freeze({ kind: "virtual" as const, virtual: reach.virtual.key, options: reach.virtual.options })
          : Object.freeze({ kind: "reference" as const }),
      justOne: exact?.justOne,
      count,
      select: exact?.select,
      match: exact?.match,
      matchFn: exact?.matchFn,
      sort: options?.sort ?? PopulatePlanner.virtualSort(virtualOptions),
      skip: options?.skip ?? virtualOptions?.options?.skip,
      limit: limit ?? virtualOptions?.perDocumentLimit ?? virtualOptions?.options?.limit,
      retainNullValues: exact?.retainNullValues === true,
      required: exact?.required === true,
      clone: exact?.clone === true,
      transform: exact?.transform,
      populate: nested,
    });
  }

  /**
   * The default sort of a virtual's options (`{ field: 1 | -1 }`).
   *
   * @param options - The virtual's options.
   * @returns The sort pairs, or `undefined` when the virtual sets none.
   */
  private static virtualSort(options: VirtualOptions | undefined): readonly SortPair[] | undefined {
    return options?.options?.sort === undefined ? undefined : QuerySpecs.sort(options.options.sort);
  }
}
