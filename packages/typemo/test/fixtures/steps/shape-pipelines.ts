/*
 * Pipelines of the step shape test: rows after the pipeline steps and the translation back (`dbName` aliases,
 * hidden fields) must have exactly the computed row types.
 */
import { fn, Pipeline } from "../../../src/index.ts";
import { Account, Plain } from "./step-entities.ts";

/**
 * The pipelines whose rows the shape test compares with their computed types.
 *
 * @example
 * type Row = RowOf<typeof ShapePipelines.accounts>;
 */
export const ShapePipelines = {
  accounts: Pipeline.from(Account).match({ age: { $gte: 0 } }),
  withPassword: Pipeline.from(Account, { include: ["password"] }).match({ name: "Ann" }),
  projected: Pipeline.from(Account).project({ name: 1, "address.city": 1 }),
  joined: Pipeline.from(Account).lookup({ from: Plain, localField: "name", foreignField: "title", as: "plain" }),
  grouped: Pipeline.from(Account).group((f) => ({ _id: f.address.city, total: fn.sum(f.age) })),
};
