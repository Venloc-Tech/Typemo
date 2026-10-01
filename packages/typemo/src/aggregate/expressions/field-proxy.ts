import type { OpaqueValue } from "../../bson/opaque-value.ts";
import { type ExprNode, ExprNodes } from "./expr-node.ts";

/*
 * `f.field`: at the type level a plain, non-recursive mapped type over the document (self-referential path
 * strings were a dead end); at runtime a `Proxy` that builds the `"$a.b"` path on property access. A typo is an
 * ordinary "property does not exist" error with real autocompletion.
 *
 * - leaves are the opaque BSON values (`OpaqueValue`), not a hand list of classes (otherwise `uuid.sub_type` and
 *   `big.low` would be offered as paths);
 * - an optional key adds `| undefined` explicitly: under `exactOptionalPropertyTypes` the `-?` of the
 *   mapped type strips it, and the proxy must still say that the field may be missing;
 * - a record (`Map` field, stored as a plain object) is addressed by any key, each `V | undefined`;
 * - a reference to a document field carries `FieldPath` (really, at runtime), so places that need a
 *   PATH and not any expression (`sortBy` of `$top`) can require it; a `$$variable` proxy does not.
 */

/**
 * How deep `f.a.b.c…` goes before a property becomes a plain node.
 *
 * `Depth[D]` is `D - 1`, so the recursion of `ProxyOf` stops after six levels.
 */
type Depth = [never, 0, 1, 2, 3, 4, 5, 6];

/** Values a field reference never walks into. */
type ProxyLeaf = string | number | boolean | bigint | OpaqueValue | readonly unknown[];

/**
 * `undefined` when the parent can be `null` or missing (then every field below it can be missing).
 *
 * @typeParam T - The parent type.
 * @example
 * ```ts
 * type A = AbsentParent<{ a: 1 } | null>; // undefined
 * type B = AbsentParent<{ a: 1 }>; // never
 * ```
 */
type AbsentParent<T> = [Extract<T, null | undefined>] extends [never] ? never : undefined;

/**
 * `undefined` for an optional key of `O`.
 *
 * @typeParam O - The object type.
 * @typeParam K - The key.
 * @example
 * ```ts
 * type A = OptionalMark<{ a?: number; b: number }, "a">; // undefined
 * type B = OptionalMark<{ a?: number; b: number }, "b">; // never
 * ```
 */
type OptionalMark<O, K extends keyof O> = object extends Pick<O, K> ? undefined : never;

/** Runtime marker of a document field reference (`f.a.b`), absent on variables and computed nodes. */
const FIELD_PATH: unique symbol = Symbol("typemo.fieldPath");

/**
 * A reference to a field of the document (see the file comment).
 *
 * @example
 * ```ts
 * const sortBy = (field: ExprNode<number> & FieldPath) => field; // accepts `f.price`, refuses `fn.add(f.a, 1)`
 * ```
 */
export interface FieldPath {
  /** Runtime marker: `true` on a document field reference. */
  readonly [FIELD_PATH]: true;
}

/**
 * The per-field properties of a proxied embedded document.
 *
 * @typeParam O - The embedded document type.
 * @typeParam A - `undefined` when a parent may be `null` or missing, otherwise `never`.
 * @typeParam D - The remaining depth.
 * @typeParam P - The extra type intersected into every node (`FieldPath` or `unknown`).
 * @example
 * ```ts
 * type F = ProxyFields<{ a: number }, never, 6, unknown>; // { readonly a: ExprNode<number> }
 * ```
 */
type ProxyFields<O, A, D extends number, P> = string extends keyof O
  ? { readonly [key: string]: ProxyOf<O[keyof O & string] | undefined | A, Depth[D], P> }
  : { readonly [K in keyof O & string]-?: ProxyOf<O[K] | OptionalMark<O, K> | A, Depth[D], P> };

/**
 * The proxy of a value of type `T`: a node, plus one property per field for an embedded document.
 *
 * @typeParam T - The value type.
 * @typeParam D - The remaining depth.
 * @typeParam P - The extra type intersected into every node.
 * @example
 * ```ts
 * type N = ProxyOf<number, 6, unknown>; // ExprNode<number>
 * type O = ProxyOf<{ a: number }, 6, unknown>; // { readonly a: ExprNode<number> } & ExprNode<{ a: number }>
 * ```
 */
type ProxyOf<T, D extends number, P> = [D] extends [never]
  ? ExprNode<T> & P
  : [NonNullable<T>] extends [never]
    ? ExprNode<T> & P
    : [NonNullable<T>] extends [ProxyLeaf]
      ? ExprNode<T> & P
      : [NonNullable<T>] extends [object]
        ? ProxyFields<NonNullable<T>, AbsentParent<T>, D, P> & ExprNode<T> & P
        : ExprNode<T> & P;

/**
 * The field reference proxy for documents of type `T`: an expression node of `T`, plus (for an
 * embedded document) one property per field. A parent that may be `null`/missing is walked into, and
 * every field below it gets `| undefined` (the server reads a missing field there).
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * type P = FieldProxy<{ price: number; meta?: { tag: string } }>;
 * // f.price is ExprNode<number>; f.meta.tag is ExprNode<string | undefined>
 * ```
 */
export type FieldProxy<T> = ProxyOf<T, 6, FieldPath>;

/**
 * The proxy of a `$$` variable (`$map`/`$filter`/`$reduce` element, `$let`, `$lookup.let`): no `FieldPath`.
 *
 * @typeParam T - The type of the variable.
 * @example
 * ```ts
 * type V = VarProxy<{ price: number }>; // v.price is ExprNode<number>, but has no FieldPath marker
 * ```
 */
export type VarProxy<T> = ProxyOf<T, 6, unknown>;

/** Runtime field references and variables. */
export class FieldProxies {
  /**
   * The document root: `f` itself is `$$ROOT` (`fn.mergeObjects(f, { … })`), `f.a.b` is `"$a.b"`.
   *
   * @typeParam T - The document type.
   * @returns The field proxy of the root.
   */
  static root<T>(): FieldProxy<T> {
    return FieldProxies.build("", "$$ROOT", false) as FieldProxy<T>;
  }

  /**
   * A `$$` variable: `variable("this").price` is `"$$this.price"`.
   *
   * @typeParam T - The type of the variable.
   * @param name - The variable name without the `$$` prefix.
   * @returns The proxy of the variable.
   */
  static variable<T>(name: string): VarProxy<T> {
    return FieldProxies.build(`$$${name}`, `$$${name}`, false) as VarProxy<T>;
  }

  /**
   * Builds one proxy node. The target stays extensible: a `has` trap may not report keys of a non-extensible
   * target (Proxy invariant); nothing can be stored on it.
   *
   * @param prefix - The path used for children (`""` at the root).
   * @param self - The serialized value of the proxy itself.
   * @param isField - Whether the node is a document field reference (carries `FieldPath`).
   * @returns The proxy.
   */
  private static build(prefix: string, self: string, isField: boolean): object {
    const node = ExprNodes.make<unknown>(self);
    const keys: PropertyKey[] = [...Reflect.ownKeys(node), ...(isField ? [FIELD_PATH] : [])];
    return new Proxy(
      {},
      {
        set: () => false,
        defineProperty: () => false,
        get: (_target, property) => {
          if (property === FIELD_PATH) return isField ? true : undefined;
          if (typeof property === "symbol") return keys.includes(property) ? Reflect.get(node, property) : undefined;
          const path = prefix === "" ? `$${property}` : `${prefix}.${property}`;
          return FieldProxies.build(path, path, prefix === "" || isField);
        },
        has: (_target, property) => typeof property === "string" || keys.includes(property),
      },
    );
  }
}
