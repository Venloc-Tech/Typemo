import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";

/*
 * Resolution of ONE dotted path of an operation against the compiled schema. One walk
 * gives everything the later steps need: the node (cast, validators, flags), the path in database names
 * (Mongoose H14: `dbName` translation keeps the caller's positional segments and Map keys) and the element node of
 * every `$[id]` (arrayFilters are cast against it).
 *
 * Three modes, because the server reads paths differently:
 * - `filter` / `read` (filter, projection, sort): a name segment goes THROUGH an array implicitly
 *   (`revisions.note` matches any element), a number is an element;
 * - `update`: an array is entered only by a number or a positional token (`$`, `$[]`, `$[id]`); a name
 *   right after an array is refused (the server says code 28).
 */

/**
 * How the server reads the path.
 *
 * @example
 * const mode: PathMode = "update";
 */
export type PathMode = "filter" | "read" | "update";

/**
 * A path that exists.
 *
 * @example
 * const resolved: ResolvedPath = {
 *   node, path: "address.zip", dbPath: "adr.zip", nullable: false, identifiers: new Map(),
 * };
 */
export interface ResolvedPath {
  /** The node the path ends at. */
  readonly node: PathNode;
  /** The path as given (code names). */
  readonly path: string;
  /** The same path in database names; positional segments, indexes and Map keys unchanged. */
  readonly dbPath: string;
  /** Some node along the path is nullable (a `null` there matches/writes legitimately). */
  readonly nullable: boolean;
  /** The element node of every `$[id]` token, by identifier. */
  readonly identifiers: ReadonlyMap<string, PathNode>;
}

/**
 * The result of a resolution: the path, or why it does not exist.
 *
 * @example
 * const ok: Resolution = { ok: true, value: resolved };
 * const bad: Resolution = { ok: false, reason: "an empty path" };
 */
export type Resolution =
  | { readonly ok: true; readonly value: ResolvedPath }
  | { readonly ok: false; readonly reason: string };

/**
 * Where a resolution starts: a document schema, or a node (an array element, a `$[id]` element).
 *
 * @example
 * const root: ResolveRoot = compiledSchema;
 */
export type ResolveRoot = CompiledSchema | PathNode;

/** A path segment that is an array index. */
const NUMERIC = /^\d+$/;
/** A positional token: `$`, `$[]` or `$[id]`. */
const POSITIONAL = /^\$(?:\[(?:[a-z][A-Za-z0-9]*)?\])?$/;
/** A `$[id]` token; the group is the identifier. */
const IDENTIFIER = /^\$\[([a-z][A-Za-z0-9]*)\]$/;

/**
 * Tells a node from a schema: a `CompiledSchema` has a `kind` too ("document" | "nested"), so nodes are told
 * apart by their caster.
 *
 * @param root - The resolution root.
 * @returns Whether `root` is a path node.
 */
const isNode = (root: ResolveRoot): root is PathNode => "caster" in root;

/**
 * Resolutions are memoized per root and mode (a compiled schema or node is immutable once sealed:
 * a path resolves the same way every time; every step of an operation resolves the same paths again).
 * Bounded: past {@link MEMO_LIMIT} paths (indexes and Map keys make paths unbounded) new ones are not kept.
 *
 * @example
 * const memo: Memo = { filter: new Map(), read: new Map(), update: new Map() };
 */
type Memo = Readonly<Record<PathMode, Map<string, Resolution>>>;
/** The memoized resolutions of each root. */
const MEMO = new WeakMap<ResolveRoot, Memo>();
/** How many resolutions are kept per root and mode. */
const MEMO_LIMIT = 2048;

/**
 * Path resolution against compiled schemas.
 *
 * @example
 * const result = PathResolver.resolve(schema, "items.0.qty", "update");
 * if (result.ok) result.value.dbPath; // "items.0.qty" in database names
 */
export class PathResolver {
  /**
   * Resolves `path` from `root` in `mode` (the result is shared and frozen: never mutate it).
   *
   * @param root - A document schema, or a node to start from.
   * @param path - The dotted path in code names.
   * @param mode - How the server reads the path.
   * @returns The resolved path, or why it does not exist.
   */
  static resolve(root: ResolveRoot, path: string, mode: PathMode): Resolution {
    let memo = MEMO.get(root);
    if (memo === undefined) {
      memo = Object.freeze({ filter: new Map(), read: new Map(), update: new Map() });
      MEMO.set(root, memo);
    }
    const byPath = memo[mode];
    const known = byPath.get(path);
    if (known !== undefined) return known;
    const resolution = PathResolver.walk(root, path, mode);
    if (resolution.ok) Object.freeze(resolution.value);
    Object.freeze(resolution);
    if (byPath.size < MEMO_LIMIT) byPath.set(path, resolution);
    return resolution;
  }

  /**
   * Walks the path segment by segment, collecting the database path, nullability and `$[id]` element nodes.
   *
   * @param root - A document schema, or a node to start from.
   * @param path - The dotted path in code names.
   * @param mode - How the server reads the path.
   * @returns The resolved path, or why it does not exist.
   */
  private static walk(root: ResolveRoot, path: string, mode: PathMode): Resolution {
    if (path === "") return { ok: false, reason: "an empty path" };
    const segments = path.split(".");
    if (segments.some((segment) => segment === "")) return { ok: false, reason: `"${path}" has an empty segment` };
    let schema: CompiledSchema | undefined = isNode(root) ? undefined : root;
    let node: PathNode | undefined = isNode(root) ? root : undefined;
    let nullable = node?.nullable ?? false;
    const db: string[] = [];
    const identifiers = new Map<string, PathNode>();
    let index = 0;
    while (index < segments.length) {
      const segment = segments[index] as string;
      if (node === undefined) {
        const field = schema === undefined ? undefined : PathResolver.field(schema, segment);
        if (field === undefined) return PathResolver.unknown(path, segment, schema);
        node = field;
        db.push(field.dbKey);
        nullable ||= field.nullable;
        index++;
        continue;
      }
      switch (node.kind) {
        case "array": {
          if (NUMERIC.test(segment) || (mode === "update" && POSITIONAL.test(segment))) {
            const id = IDENTIFIER.exec(segment)?.[1];
            if (id !== undefined) identifiers.set(id, node.element);
            node = node.element;
            db.push(segment);
            nullable ||= node.nullable;
            index++;
            continue;
          }
          if (segment.startsWith("$")) {
            /* `arr.$` in a projection (the matched element) is the only positional form a read takes. */
            if (mode === "read" && segment === "$" && index === segments.length - 1) {
              node = node.element;
              db.push(segment);
              index++;
              continue;
            }
            return PathResolver.failure(path, segment, "is not allowed here");
          }
          if (mode === "update") {
            return {
              ok: false,
              reason: `"${path}": "${segment}" goes through the array "${node.path}" without an index or a positional token ($, $[], $[id]) — the server refuses it (code 28)`,
            };
          }
          /* filter/read: a name goes through the array implicitly (do not consume the segment). */
          node = node.element;
          nullable ||= node.nullable;
          continue;
        }
        case "map":
          if (segment.startsWith("$")) return { ok: false, reason: `"${path}": a Map key cannot start with "$"` };
          node = node.value;
          db.push(segment);
          nullable ||= node.nullable;
          index++;
          continue;
        case "subdocument":
        case "nested": {
          schema = node.schema;
          const field = PathResolver.field(schema, segment);
          if (field === undefined) return PathResolver.unknown(path, segment, schema);
          node = field;
          db.push(field.dbKey);
          nullable ||= field.nullable;
          index++;
          continue;
        }
        default:
          return { ok: false, reason: `"${path}": "${node.path}" is a ${node.kind} value, it has no "${segment}"` };
      }
    }
    if (node === undefined) return { ok: false, reason: `"${path}" names nothing` };
    return { ok: true, value: { node, path, dbPath: db.join("."), nullable, identifiers } };
  }

  /**
   * A field of a schema by property name; a field declared only by discriminators of the schema (an
   * embedded union) resolves through the first discriminator that declares it — the types give
   * the union of the members' paths too.
   *
   * @param schema - The compiled schema.
   * @param key - The property name.
   * @returns The node, or `undefined` when neither the schema nor its discriminators declare it.
   */
  static field(schema: CompiledSchema, key: string): PathNode | undefined {
    const own = schema.field(key);
    if (own !== undefined) return own;
    for (const discriminator of schema.discriminators.values()) {
      const target = discriminator.target;
      if (target !== schema.target && !(target.prototype instanceof schema.target)) continue;
      const found = discriminator.field(key);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /**
   * The failed resolution of an unknown field.
   *
   * @param path - The whole path.
   * @param segment - The segment that names no field.
   * @param schema - The schema searched, if any.
   * @returns A failed resolution with the reason.
   */
  private static unknown(path: string, segment: string, schema: CompiledSchema | undefined): Resolution {
    return PathResolver.failure(path, segment, `is not a field of ${schema?.name ?? "the value"}`);
  }

  /**
   * A failed resolution about one segment. The whole path is named only when it says more than the segment,
   * so a one-segment path is not printed twice (`"nope" is not a field of User`, not `"nope": "nope" …`).
   *
   * @param path - The whole path.
   * @param segment - The offending segment.
   * @param text - What is wrong with the segment, without the segment itself.
   * @returns A failed resolution with the reason.
   */
  private static failure(path: string, segment: string, text: string): Resolution {
    return { ok: false, reason: `${path === segment ? "" : `"${path}": `}"${segment}" ${text}` };
  }
}
