/* `$expr` in a query filter: the cost of `ExprFor<T>` when it is used. */
import { type ExprFor, fn } from "@venloc/typemo";
import type { Comment, Post, User } from "../entities.ts";

export const e1: ExprFor<User> = (f) => fn.gt(f.visits, 10n);
export const e2: ExprFor<Post> = (f) => fn.and(fn.gt(f.meta.views, f.meta.likes), fn.isIn("news", f.tags));
export const e3: ExprFor<Comment> = (f) => fn.lt(fn.size(f.replies), f.score);
