import { BsonGuards } from "../bson/bson-guards.ts";
import { type QueryCursor, TypedCursor } from "../cursor/typed-cursor.ts";
import { QueryError } from "../errors/query-error.ts";
import { StrictModeError } from "../errors/strict-mode-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import type { ExpectRows } from "../types/contract.ts";
import type { PathError } from "../types/paths.ts";
import { type ExecOptions, ExecutionOnce } from "./executable-query.ts";
import type { OperationKind } from "./plan.ts";

/*
 * `.mask(spec)` masks the RESULT a caller receives (not telemetry: hooks, events and audit ran on the
 * real data before). A spec is compiled once into a path tree (cached by the spec object) and applied as the last
 * step, after populate and the lean/plain conversion, visiting only the listed paths. No `.mask()`: no code runs.
 * There is no "sensitive" preset (only the listed paths are masked; hiding a field is `select`), and a `null` or
 * `undefined` value at a mask path becomes `"?"` without calling the mask (so a mask function never sees them).
 */

/**
 * A mask function of a value `V`: a plain function or a `Mask.*` object.
 *
 * @typeParam V - The value the function receives.
 * @example
 * const last4: MaskFunction<string> = (value) => `****${value.slice(-4)}`;
 */
export type MaskFunction<V> = ((value: V) => unknown) | { readonly mask: (value: V) => unknown };

/**
 * One value of a spec: `"mask"` (the value becomes `"?"`) or a mask function.
 *
 * @typeParam V - The value the function receives.
 * @example
 * const a: MaskValue<string> = "mask";
 * const b: MaskValue<string> = (value) => value.toUpperCase();
 */
export type MaskValue<V> = "mask" | MaskFunction<V>;

/**
 * A value with no inner paths (scalars, dates, BSON values, bytes).
 *
 * @example
 * const a: MaskLeaf = "text";
 * const b: MaskLeaf = new Date();
 */
type MaskLeaf =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | RegExp
  | Uint8Array
  | { readonly _bsontype: string };

/**
 * A type-level decrementing depth counter.
 *
 * @example
 * type A = Prev[6]; // 5
 */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6];

/**
 * The inner paths of a value (its elements for an array, `$*` for a Map or a record).
 *
 * @typeParam V - The value type.
 * @typeParam D - The remaining depth.
 * @example
 * type A = InnerPaths<{ a: { b: string }[] }, 6>; // "a" | "a.b"
 * type B = InnerPaths<Map<string, { c: number }>, 6>; // "$*" | "$*.c"
 */
type InnerPaths<V, D extends number> = [D] extends [never]
  ? never
  : V extends MaskLeaf
    ? never
    : V extends readonly (infer E)[]
      ? InnerPaths<NonNullable<E>, D>
      : V extends ReadonlyMap<string, infer M>
        ? "$*" | `$*.${InnerPaths<NonNullable<M>, Prev[D]>}`
        : V extends object
          ? string extends keyof V
            ? "$*" | `$*.${InnerPaths<NonNullable<V[string & keyof V]>, Prev[D]>}`
            : {
                [K in keyof V & string]-?: K | `${K}.${InnerPaths<NonNullable<V[K]>, Prev[D]>}`;
              }[keyof V & string]
          : never;

/**
 * The typed paths of a result row that `.mask()` accepts.
 *
 * @typeParam Row - The result row type.
 * @example
 * type A = MaskPaths<{ email: string; card: { number: string } }>; // "email" | "card" | "card.number"
 */
export type MaskPaths<Row> = InnerPaths<NonNullable<Row>, 6>;

/**
 * The element type of a (readonly) array, recursively; the value itself otherwise.
 *
 * @typeParam V - The value type.
 * @example
 * type A = Element<string[][]>; // string
 */
type Element<V> = V extends readonly (infer E)[] ? Element<E> : V;

/**
 * The value at a mask path of a row (array elements traversed, `$*` = any Map/record value).
 *
 * @typeParam Row - The result row type.
 * @typeParam P - The mask path.
 * @example
 * type A = MaskValueAt<{ card: { number: string }[] }, "card.number">; // string
 */
export type MaskValueAt<Row, P extends string> = MaskStep<Element<NonNullable<Row>>, P>;

/**
 * Walks a mask path one segment at a time.
 *
 * @typeParam V - The value reached so far.
 * @typeParam P - The remaining path.
 * @example
 * type A = MaskStep<{ a: { b: 1 } }, "a.b">; // 1
 */
type MaskStep<V, P extends string> = P extends `${infer H}.${infer R}` ? MaskValueAt<MaskKey<V, H>, R> : MaskKey<V, P>;

/**
 * The value at one path segment; `$*` is any value of a Map or a record.
 *
 * @typeParam V - The value reached so far.
 * @typeParam K - The segment.
 * @example
 * type A = MaskKey<Map<string, number>, "$*">; // number
 * type B = MaskKey<{ a: 1 }, "a">; // 1
 */
type MaskKey<V, K extends string> = K extends "$*"
  ? V extends ReadonlyMap<string, infer M>
    ? M
    : V[string & keyof V]
  : K extends keyof V
    ? V[K]
    : never;

/**
 * The check of a spec: every key a path of the row, every value `"mask"` or a function of the value there — without
 * `null`/`undefined` (those become `"?"` before the function is called).
 *
 * @typeParam Row - The result row type.
 * @typeParam Spec - The mask spec literal type.
 * @example
 * type A = MaskSpecCheck<{ email: string }, { email: "mask" }>; // { readonly email: MaskValue<string> }
 * type B = MaskSpecCheck<{ email: string }, { emial: "mask" }>; // { readonly emial: PathError<...> }
 */
export type MaskSpecCheck<Row, Spec> = {
  readonly [P in keyof Spec]: P extends MaskPaths<Row>
    ? MaskValue<NonNullable<MaskValueAt<Row, P>>>
    : PathError<`mask: "${P & string}" is not a path of the result row`>;
};

/**
 * What a masked field holds: `"?"` for `"mask"`, the function's result otherwise.
 *
 * @typeParam M - The mask spec value.
 * @example
 * type A = MaskResult<"mask">; // "?"
 * type B = MaskResult<(value: string) => number>; // number
 */
export type MaskResult<M> = M extends "mask"
  ? "?"
  : M extends { readonly mask: (value: never) => infer R }
    ? R
    : M extends (value: never) => infer R
      ? R
      : never;

/**
 * `"?"` when a value can be `null`/`undefined` (such a value is `"?"`, the mask is not called).
 *
 * @typeParam V - The value type.
 * @example
 * type A = NullMark<string | null>; // "?"
 * type B = NullMark<string>; // never
 */
type NullMark<V> = null extends V ? "?" : undefined extends V ? "?" : never;

/**
 * The part of a spec below key `K`, with the `K.` prefix removed.
 *
 * @typeParam Spec - The spec type.
 * @typeParam K - The key.
 * @example
 * type A = SubSpec<{ "card.number": "mask"; email: "mask" }, "card">; // { number: "mask" }
 */
type SubSpec<Spec, K extends string> = {
  [P in keyof Spec as P extends `${K}.${infer R}` ? R : never]: Spec[P];
};

/**
 * The value type after masking: masked leaves become their mask result, the rest is walked and kept.
 *
 * @typeParam V - The value type.
 * @typeParam Spec - The spec type relative to `V`.
 * @example
 * type A = MaskedValue<{ email: string; name: string }, { email: "mask" }>; // { email: "?"; name: string }
 */
type MaskedValue<V, Spec> = keyof Spec extends never
  ? V
  : V extends MaskLeaf
    ? V
    : V extends readonly (infer E)[]
      ? MaskedValue<E, Spec>[]
      : V extends ReadonlyMap<infer K, infer M>
        ? Map<K, "$*" extends keyof Spec ? MaskResult<Spec["$*"]> | NullMark<M> : MaskedValue<M, SubSpec<Spec, "$*">>>
        : V extends object
          ? string extends keyof V
            ? Record<
                string,
                "$*" extends keyof Spec
                  ? MaskResult<Spec["$*"]> | NullMark<V[string & keyof V]>
                  : MaskedValue<V[string & keyof V], SubSpec<Spec, "$*">>
              >
            : {
                [K in keyof V]: K extends keyof Spec
                  ? MaskResult<Spec[K]> | NullMark<V[K]>
                  : MaskedValue<V[K], SubSpec<Spec, K & string>>;
              }
          : V;

/**
 * The row type after `.mask(spec)`: `"mask"` → `"?"`, a function → its result, plus `"?"` where the
 * value can be `null`/`undefined`. A missing key stays missing (an optional key stays optional).
 *
 * @typeParam Row - The result row type.
 * @typeParam Spec - The mask spec literal type.
 * @example
 * type A = ApplyMask<{ email: string; age: number }, { email: "mask" }>; // { email: "?"; age: number }
 */
export type ApplyMask<Row, Spec> = MaskedValue<Row, Spec>;

/**
 * A compiled mask: what to do at this node (a leaf), and the listed paths below it.
 *
 * @example
 * const node: MaskNode = { children: new Map() };
 */
interface MaskNode {
  /** What to do at this node; absent when the node only leads to deeper paths. */
  leaf?: { readonly path: string; readonly apply: (value: unknown) => unknown };
  /** The nodes of the next path segments. */
  readonly children: Map<string, MaskNode>;
}

/**
 * Where a mask path is while it is checked: the schemas of a (sub)document (a model and its discriminators), or the
 * node of a field.
 *
 * @example
 * const at: MaskPosition = [schema];
 */
type MaskPosition = readonly CompiledSchema[] | PathNode;

/** The path trees of frozen specs, cached per spec object. */
const TREES = new WeakMap<object, MaskNode>();

/**
 * Compiles and applies response masks.
 *
 * @example
 * const tree = ResponseMask.compile({ email: "mask" });
 * ResponseMask.apply(tree, { email: "a@b.c" }, "User"); // { email: "?" }
 */
export class ResponseMask {
  /**
   * The path tree of a spec, read when `.mask()` is called. Only a FROZEN spec is cached (once per
   * object) — a mutable one is compiled on every call, so a key added to a reused spec object is never silently
   * ignored by a stale tree. Freezing it is the caller's choice (the input is never mutated by Typemo).
   *
   * @param spec - An object of paths to masks.
   * @returns The path tree.
   * @throws {QueryError} When `spec` is not an object, has an empty path, or a value is not a mask.
   */
  static compile(spec: unknown): MaskNode {
    if (!BsonGuards.isPlainObject(spec)) throw new QueryError("mask: the spec is an object of paths");
    const frozen = Object.isFrozen(spec);
    const cached = frozen ? TREES.get(spec) : undefined;
    if (cached !== undefined) return cached;
    const root: MaskNode = { children: new Map() };
    for (const [path, value] of Object.entries(spec)) {
      if (path === "") throw new QueryError("mask: an empty path");
      ResponseMask.insert(root, path.split("."), ResponseMask.leafOf(path, value));
    }
    if (frozen) TREES.set(spec, root);
    return root;
  }

  /**
   * The leaf of one spec entry.
   *
   * @param path - The masked path.
   * @param value - `"mask"`, a function, or an object with a `mask` function.
   * @returns The leaf that applies the mask.
   * @throws {QueryError} When `value` is not a mask.
   */
  private static leafOf(path: string, value: unknown): NonNullable<MaskNode["leaf"]> {
    if (value === "mask") return { path, apply: () => "?" };
    if (typeof value === "function") return { path, apply: value as (value: unknown) => unknown };
    if (typeof value === "object" && value !== null && typeof (value as { mask?: unknown }).mask === "function") {
      const fn = (value as { readonly mask: (value: unknown) => unknown }).mask;
      return { path, apply: (inner) => fn(inner) };
    }
    throw new QueryError(`mask: "${path}" takes "mask" or a mask function`, { path });
  }

  /**
   * Adds a leaf to the tree at the node of the given path segments, creating nodes on the way.
   *
   * @param root - The root of the tree.
   * @param segments - The path split on dots.
   * @param leaf - The leaf to set.
   */
  private static insert(root: MaskNode, segments: readonly string[], leaf: NonNullable<MaskNode["leaf"]>): void {
    let node = root;
    for (const segment of segments) {
      let next = node.children.get(segment);
      if (next === undefined) {
        next = { children: new Map() };
        node.children.set(segment, next);
      }
      node = next;
    }
    node.leaf = leaf;
  }

  /**
   * Checks the paths of a compiled spec against the rows of a model, as `select` checks its paths: a path that
   * names no field (of the model, its discriminators and embedded documents, a virtual, or an extra field of the
   * query such as a text score) is refused — a mask that silently masks nothing would leak the value. Below a
   * reference (a populated path) or a virtual any path is accepted: the rows there are another model's.
   *
   * @param tree - The compiled path tree.
   * @param schema - The compiled schema of the rows.
   * @param extra - Top-level fields the query adds to the rows (computed projections, text score).
   * @throws {StrictModeError} With reason `unknown-path` for a path that is not a path of the rows.
   */
  static check(tree: MaskNode, schema: CompiledSchema, extra: ReadonlySet<string> = new Set()): void {
    const visit = (node: MaskNode, at: MaskPosition, prefix: readonly string[]): void => {
      for (const [segment, child] of node.children) {
        const path = [...prefix, segment];
        const next = ResponseMask.step(at, segment, prefix.length === 0 ? extra : undefined);
        if (next === undefined) {
          const dotted = path.join(".");
          throw new StrictModeError(
            "unknown-path",
            `mask: "${dotted}" is not a path of ${schema.name}'s rows, so it would mask nothing; name a field of the rows`,
            { path: dotted },
          );
        }
        if (next !== "any") visit(child, next, path);
      }
    };
    visit(tree, [schema, ...schema.discriminators.values()], []);
  }

  /**
   * The position one segment below `at`.
   *
   * @param at - The schemas of a (sub)document, or the node of a field.
   * @param segment - The next path segment.
   * @param extra - Extra top-level field names (at the root only).
   * @returns The next position, `"any"` when anything below is accepted, `undefined` for an unknown segment.
   */
  private static step(
    at: MaskPosition,
    segment: string,
    extra: ReadonlySet<string> | undefined,
  ): MaskPosition | "any" | undefined {
    if (Array.isArray(at)) {
      if (extra?.has(segment) === true) return "any";
      for (const schema of at as readonly CompiledSchema[]) {
        const node = schema.field(segment);
        if (node !== undefined) return ResponseMask.below(node);
        if (schema.virtuals.some((virtual) => virtual.key === segment)) return "any";
      }
      return undefined;
    }
    let node = at as PathNode;
    while (node.kind === "array") node = node.element;
    if (node.kind === "map") return ResponseMask.below(node.value);
    if (node.kind === "subdocument" || node.kind === "nested")
      return ResponseMask.step([node.schema, ...node.schema.discriminators.values()], segment, undefined);
    return undefined;
  }

  /**
   * The position of a field's value: anything below a reference (a populated path holds another model's rows).
   *
   * @param node - The field node.
   * @returns The node, or `"any"` for a reference.
   */
  private static below(node: PathNode): PathNode | "any" {
    let inner = node;
    while (inner.kind === "array") inner = inner.element;
    return inner.ref !== undefined || inner.refPath !== undefined || inner.refModel !== undefined ? "any" : node;
  }

  /**
   * The spec paths that matched nothing in a result (`seen` from {@link ResponseMask.apply}).
   *
   * @param tree - The compiled path tree.
   * @param seen - The leaf paths met in the rows.
   * @returns The paths never met.
   */
  static unmatched(tree: MaskNode, seen: ReadonlySet<string>): string[] {
    const out: string[] = [];
    const visit = (node: MaskNode): void => {
      if (node.leaf !== undefined && !seen.has(node.leaf.path)) out.push(node.leaf.path);
      for (const child of node.children.values()) visit(child);
    };
    visit(tree);
    return out;
  }

  /**
   * The error of mask paths no row has.
   *
   * @param paths - The paths never met.
   * @param model - The model name.
   * @returns The error.
   */
  static unmatchedError(paths: readonly string[], model: string): StrictModeError {
    return new StrictModeError(
      "unknown-path",
      `mask: ${paths.map((path) => `"${path}"`).join(", ")} matched nothing in the rows of ${model}'s aggregation, so nothing would be masked there; name a field of the final rows`,
      { path: paths[0] ?? "" },
    );
  }

  /**
   * A result (rows, one row or `null`) with the masks applied; `model` names the model in errors.
   *
   * @param tree - The compiled path tree.
   * @param result - The rows, one row, or `null`.
   * @param model - The model name, for error messages.
   * @param seen - Receives the leaf paths met in the rows (the check of an aggregation).
   * @returns A masked copy; the input is not changed.
   * @throws {QueryError} When a mask function throws.
   */
  static apply(tree: MaskNode, result: unknown, model: string, seen?: Set<string>): unknown {
    return Array.isArray(result)
      ? result.map((row) => ResponseMask.walk(tree, row, model, seen))
      : ResponseMask.walk(tree, result, model, seen);
  }

  /**
   * Copies a value and masks the listed paths inside it (arrays, Maps and objects are walked).
   *
   * @param node - The tree node for this value.
   * @param value - The value.
   * @param model - The model name, for error messages.
   * @param seen - Receives the leaf paths met.
   * @returns The masked copy.
   * @throws {QueryError} When a mask function throws.
   */
  private static walk(node: MaskNode, value: unknown, model: string, seen?: Set<string>): unknown {
    if (Array.isArray(value)) return value.map((one) => ResponseMask.walk(node, one, model, seen));
    if (value instanceof Map) {
      const out = new Map<unknown, unknown>();
      for (const [key, inner] of value) out.set(key, inner);
      for (const [key, child] of node.children) {
        const targets = key === "$*" ? [...value.keys()] : value.has(key) ? [key] : [];
        for (const target of targets) {
          out.set(target, ResponseMask.visit(child, value.get(target), model, seen));
        }
      }
      return out;
    }
    if (typeof value !== "object" || value === null) return value;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = { ...source };
    for (const [key, child] of node.children) {
      const targets = key === "$*" ? Object.keys(source) : Object.hasOwn(source, key) ? [key] : [];
      for (const target of targets) {
        out[target] = ResponseMask.visit(child, source[target], model, seen);
      }
    }
    return out;
  }

  /**
   * Applies the leaf of a node to a value, or walks deeper when the node has no leaf.
   *
   * @param node - The tree node for this value.
   * @param value - The value.
   * @param model - The model name, for error messages.
   * @param seen - Receives the leaf paths met.
   * @returns The masked value.
   * @throws {QueryError} When the mask function throws.
   */
  private static visit(node: MaskNode, value: unknown, model: string, seen?: Set<string>): unknown {
    const leaf = node.leaf;
    if (leaf === undefined) return ResponseMask.walk(node, value, model, seen);
    seen?.add(leaf.path);
    /* A null/undefined value is "?" and the mask is not called (its parameter type excludes them). */
    if (value === null || value === undefined) return "?";
    try {
      return leaf.apply(value);
    } catch (error) {
      throw new QueryError(`mask: the mask of "${leaf.path}" (model ${model}) threw`, {
        path: leaf.path,
        cause: error,
      });
    }
  }
}

/**
 * What a masked query reads: a whole result, and (for lists) a stream of rows.
 *
 * @example
 * const source: MaskSource = { op: "find", model: "User", run: () => query.exec(), cursor: () => query.cursor() };
 */
export interface MaskSource {
  /** The operation kind (reads are memoized, writes run once). */
  readonly op: OperationKind;
  /** The method the user called, for error texts (`aggregate`, `findById`); the operation kind by default. */
  readonly method?: string;
  /** The model name, for error messages. */
  readonly model: string;
  /** Runs the query once more. */
  readonly run: () => Promise<unknown>;
  /** The rows as a cursor (lists only). */
  readonly cursor?: () => QueryCursor<unknown>;
  /**
   * The rows are not the model's (an aggregation): the paths are checked against the rows that come back, and a
   * path no row has is a `StrictModeError` (`unknown-path`).
   */
  readonly checkRows?: boolean;
}

/**
 * A lean or plain query whose result is masked: terminal, like a parsed query (`await`/`exec`,
 * `cursor()` for lists, `expect`). `Result` is what it resolves to, `Row` one masked row.
 *
 * @typeParam Result - What the query resolves to.
 * @typeParam Row - One masked row.
 * @typeParam Many - Whether the query is a list.
 * @example
 * const users = await User.find().lean().mask({ email: "mask" });
 */
export class MaskedQuery<Result, Row, Many extends boolean> implements Promise<Result> {
  readonly #source: MaskSource;
  readonly #tree: MaskNode;
  readonly #once = new ExecutionOnce();

  /**
   * Not for direct use: call `query.lean().mask(spec)`.
   * @param source - What to run and stream.
   * @param tree - The compiled mask.
   */
  constructor(source: MaskSource, tree: MaskNode) {
    this.#source = source;
    this.#tree = tree;
  }

  /**
   * Runs the query and masks the result (a read once per object; `{ force: true }` runs it again).
   *
   * @param options - Execution options.
   * @returns The masked result.
   * @throws {QueryError} When `options` are invalid or a mask function throws.
   * @throws {StrictModeError} For an aggregation, when a mask path matched nothing in the rows.
   */
  exec(options?: ExecOptions): Promise<Result> {
    return this.#once.run(
      this.#source.op,
      async () => {
        const rows = await this.#source.run();
        if (this.#source.checkRows !== true) return ResponseMask.apply(this.#tree, rows, this.#source.model);
        const seen = new Set<string>();
        const masked = ResponseMask.apply(this.#tree, rows, this.#source.model, seen);
        const unmatched = Array.isArray(rows) && rows.length > 0 ? ResponseMask.unmatched(this.#tree, seen) : [];
        if (unmatched.length > 0) throw ResponseMask.unmatchedError(unmatched, this.#source.model);
        return masked;
      },
      options,
      this.#source.method ?? this.#source.op,
    ) as Promise<Result>;
  }

  /**
   * Makes the query awaitable: runs it and chains the handlers.
   *
   * @param onfulfilled - Called with the result.
   * @param onrejected - Called with the error.
   * @returns A promise of the handlers' result.
   */
  // biome-ignore lint/suspicious/noThenProperty: a query is deliberately awaitable.
  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /**
   * Attaches a rejection handler (runs the query).
   *
   * @param onrejected - Called with the error.
   * @returns A promise of the result or of the handler's value.
   */
  catch<R2 = never>(onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<Result | R2> {
    return this.exec().catch(onrejected);
  }

  /**
   * Attaches a completion handler (runs the query).
   *
   * @param onfinally - Called when the promise settles.
   * @returns A promise of the result.
   */
  finally(onfinally?: (() => void) | null): Promise<Result> {
    return this.exec().finally(onfinally);
  }

  /**
   * The tag `Object.prototype.toString` prints (`[object TypemoQuery]`). With `then`, `catch` and `finally` it
   * completes the `Promise` interface, so a query can be returned where a `Promise` of its result is expected.
   *
   * @returns `"TypemoQuery"`.
   */
  get [Symbol.toStringTag](): string {
    return "TypemoQuery";
  }

  /**
   * Streams the rows, each masked as it is read (lists only).
   *
   * @returns A cursor of masked rows.
   * @throws {QueryError} When the query is not a list.
   */
  cursor(
    this: MaskedQuery<Result, Row, Many> &
      (Many extends true ? unknown : PathError<"cursor() applies to a list (find, aggregate)">),
  ): QueryCursor<Row> {
    const open = this.#source.cursor;
    if (open === undefined) throw new QueryError("cursor() applies to a list (find, aggregate)");
    const inner = open();
    const tree = this.#tree;
    const model = this.#source.model;
    const seen = this.#source.checkRows === true ? new Set<string>() : undefined;
    const rows = async function* (): AsyncGenerator<unknown, void, undefined> {
      let count = 0;
      for await (const row of inner) {
        count += 1;
        yield ResponseMask.apply(tree, row, model, seen);
      }
      /* An aggregation: a path no row had is reported when the stream ends. */
      const unmatched = seen !== undefined && count > 0 ? ResponseMask.unmatched(tree, seen) : [];
      if (unmatched.length > 0) throw ResponseMask.unmatchedError(unmatched, model);
    };
    const iterable = rows();
    return new TypedCursor<Row>({
      [Symbol.asyncIterator]: () => iterable as AsyncIterator<Row, void, undefined>,
      close: () => inner.close(),
    });
  }

  /**
   * The exact contract check of the masked rows, types only.
   *
   * @typeParam Shape - The exact row shape expected.
   * @returns This query, unchanged.
   */
  expect<Shape>(this: MaskedQuery<Result, Row, Many> & ExpectRows<Row, Shape>): MaskedQuery<Result, Row, Many> {
    return this;
  }
}
