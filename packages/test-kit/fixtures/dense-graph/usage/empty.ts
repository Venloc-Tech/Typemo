/* Baseline: the graph and the types are loaded, no query is written. */
import type { User } from "../entities.ts";
import type { UserModel } from "../models.ts";

export type Baseline = [User, typeof UserModel];
