import type { ExprNode } from "./expr-node.ts";
import { accumulatorOps } from "./ops/accumulator-ops.ts";
import { arithmeticOps } from "./ops/arithmetic-ops.ts";
import { arrayOps } from "./ops/array-ops.ts";
import { conversionOps } from "./ops/conversion-ops.ts";
import { dateOps } from "./ops/date-ops.ts";
import { logicOps } from "./ops/logic-ops.ts";
import { miscOps } from "./ops/misc-ops.ts";
import { objectOps } from "./ops/object-ops.ts";
import { stringOps } from "./ops/string-ops.ts";
import { windowOps } from "./ops/window-ops.ts";
import { Vars } from "./vars.ts";

/*
 * `fn.*` — the aggregation expression operators. One flat namespace, so `fn.` completes every operator; the
 * modules under `ops/` group them by topic. Names follow MongoDB without `$`, except `toString_` (`toString` is
 * `Object.prototype`'s), `typeOf` (`$type`) and `isIn` (`$in`).
 */

/** Operators that take no arguments and return a system variable. */
const shortcuts = {
  /** `$$NOW`: the current time, the same for the whole aggregation. */
  now: (): ExprNode<Date> => Vars.NOW,
  /** `$$REMOVE`: removes the field it is assigned to (the key leaves the result type). */
  remove: (): ExprNode<undefined> => Vars.REMOVE,
};

/**
 * The aggregation expression operators, one flat frozen namespace: `fn.add`, `fn.concat`, `fn.sum`, …
 *
 * @example
 * ```ts
 * fn.add(f.price, 1); // ExprNode<number>
 * fn.concat(f.first, " ", f.last); // ExprNode<string>
 * ```
 */
export const fn = Object.freeze({
  ...arithmeticOps,
  ...conversionOps,
  ...stringOps,
  ...logicOps,
  ...arrayOps,
  ...objectOps,
  ...dateOps,
  ...accumulatorOps,
  ...windowOps,
  ...miscOps,
  ...shortcuts,
});

/**
 * The operator catalog type.
 *
 * @example
 * ```ts
 * const catalog: Fn = fn;
 * type Add = Fn["add"]; // the typed `$add` operator
 * ```
 */
export type Fn = typeof fn;
