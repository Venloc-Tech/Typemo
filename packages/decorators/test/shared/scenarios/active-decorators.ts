/*
 * Runtime bridge of the alias `@typemo-shared/decorators` (see scenarios/tsconfig.json): the runner's preload puts
 * its decorators module on a global symbol before any scenario loads. Typed as the legacy shim: only the runtime
 * goes through this file; tsc resolves the alias to the runner's own shim.
 */
import type * as LegacyShim from "../legacy/decorators.ts";

/**
 * The shape of the decorators module.
 *
 * @example
 * ```ts
 * const schema: Kit["Schema"] = kit().Schema;
 * ```
 */
type Kit = typeof LegacyShim;

/** The global symbol the runner's preload stores its decorators module under. */
const KEY = Symbol.for("typemo.shared.decorators");

/**
 * The decorators module registered by the runner's preload.
 *
 * @returns The module.
 * @throws Error - When the suite is not started from a runner folder.
 */
const kit = (): Kit => {
  const value = (globalThis as { [KEY]?: Kit })[KEY];
  if (value === undefined) throw new Error("run the shared suite from a runner folder (legacy/ or tc39/)");
  return value;
};

/** The active `Schema` decorator. */
export const Schema: Kit["Schema"] = kit().Schema;
/** The active `Prop` decorator. */
export const Prop: Kit["Prop"] = kit().Prop;
/** The active `Virtual` decorator. */
export const Virtual: Kit["Virtual"] = kit().Virtual;
/** The active `Index` decorator. */
export const Index: Kit["Index"] = kit().Index;
/** The active `Pre` hook decorator. */
export const Pre: Kit["Pre"] = kit().Pre;
/** The active `Post` hook decorator. */
export const Post: Kit["Post"] = kit().Post;
/** The active `PostError` hook decorator. */
export const PostError: Kit["PostError"] = kit().PostError;
/** The active `Plugin` decorator. */
export const Plugin: Kit["Plugin"] = kit().Plugin;
/** The active `Discriminator` decorator. */
export const Discriminator: Kit["Discriminator"] = kit().Discriminator;
