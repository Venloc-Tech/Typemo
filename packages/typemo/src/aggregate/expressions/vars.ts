import type { Timestamp } from "mongodb";
import { type ExprNode, ExprNodes } from "./expr-node.ts";

/*
 * System variables (`$$NOW`, `$$REMOVE`, …) as typed nodes. A variable is never written as a string:
 * a bare `"$$PRUNE"` in an expression position is serialized as a `$literal` (see `ExprNodes.serialize`).
 * `$$ROOT` is `f` itself; `$$CURRENT` is the same document unless rebound (not offered).
 * @see https://www.mongodb.com/docs/manual/reference/aggregation-variables/
 */

/**
 * What a `$redact` expression must evaluate to (phantom names of `$$DESCEND`, `$$PRUNE`, `$$KEEP`).
 *
 * @example
 * ```ts
 * const verdict: RedactVerdict = "prune"; // the type of `Vars.PRUNE` is `ExprNode<"prune">`
 * ```
 */
export type RedactVerdict = "descend" | "prune" | "keep";

/**
 * One entry of `$$USER_ROLES`.
 *
 * @example
 * ```ts
 * const role: UserRole = { _id: "admin.alice", role: "readWrite", db: "shop" };
 * ```
 */
export interface UserRole {
  /** The role identifier, `<db>.<user>`. */
  _id: string;
  /** The role name. */
  role: string;
  /** The database the role is defined on. */
  db: string;
}

/** The typed nodes of the MongoDB system variables. */
export class Vars {
  /** The current time, the same for the whole aggregation. */
  static readonly NOW: ExprNode<Date> = ExprNodes.make("$$NOW");
  /** The cluster time (replica sets and sharded clusters only). */
  static readonly CLUSTER_TIME: ExprNode<Timestamp> = ExprNodes.make("$$CLUSTER_TIME");
  /** Assigning it removes the field (`$addFields`/`$project`): the key leaves the result type. */
  static readonly REMOVE: ExprNode<undefined> = ExprNodes.make("$$REMOVE");
  /** The roles of the current user. */
  static readonly USER_ROLES: ExprNode<UserRole[]> = ExprNodes.make("$$USER_ROLES");
  /** `$redact`: keep the fields at this level and evaluate the embedded documents. */
  static readonly DESCEND: ExprNode<"descend"> = ExprNodes.make("$$DESCEND");
  /** `$redact`: drop this document or embedded document. */
  static readonly PRUNE: ExprNode<"prune"> = ExprNodes.make("$$PRUNE");
  /** `$redact`: keep this level and everything below it. */
  static readonly KEEP: ExprNode<"keep"> = ExprNodes.make("$$KEEP");
}
