/*
 * Variable scoping for `$map` / `$filter` / `$reduce`.
 *
 * Binding the element of every `$map`/`$filter` to `$$this` and the accumulator of `$reduce` to `$$value` breaks
 * when they are nested: the inner operator rebinds `$$this`, so the OUTER element used inside the inner callback
 * would silently read the inner element:
 *
 *   fn.map({ input: f.orders, in: (o) => fn.map({ input: o.items, in: (i) => fn.multiply(i.qty, o.rate) }) })
 *   // o.rate → "$$this.rate" → the ITEM's rate (missing) → null
 *
 * Callbacks are pure builders, so the fix is to run a callback once with the default names and, if
 * another scoped operator was built inside it, run it again with names unique to its depth:
 * `$map`/`$filter` get `as: "tmoEl<d>"`, `$reduce` (which has no `as`) binds its two variables through a
 * `$let`. The common, non-nested case keeps the plain `$$this` / `$$value` of the MongoDB docs.
 */

/** One scoped operator being built. */
interface Frame {
  /** Set when another scoped operator was built inside this one's callback. */
  nested: boolean;
}

/** Tracks the nesting of scoped operators so variable names can be made unique when needed. */
export class ScopeTracker {
  /** The scoped operators currently being built, outermost first. */
  private static readonly frames: Frame[] = [];

  /**
   * Runs `build(names)` for one scoped operator. `plain` names are tried first; when the callback
   * built another scoped operator, it is rebuilt with `unique(depth)` names.
   *
   * @typeParam N - The type of the variable names object.
   * @typeParam R - The type of the built operator.
   * @param plain - The default names (`$$this` / `$$value`).
   * @param unique - Makes names unique to a nesting depth.
   * @param build - Builds the operator from the names; `renamed` tells whether unique names are in use.
   * @returns The built operator.
   */
  static build<N, R>(plain: N, unique: (depth: number) => N, build: (names: N, renamed: boolean) => R): R {
    const depth = ScopeTracker.frames.length;
    const parent = ScopeTracker.frames[depth - 1];
    if (parent !== undefined) parent.nested = true;
    const frame: Frame = { nested: false };
    ScopeTracker.frames.push(frame);
    try {
      const first = build(plain, false);
      if (!frame.nested) return first;
      frame.nested = false;
      return build(unique(depth), true);
    } finally {
      ScopeTracker.frames.pop();
    }
  }
}
