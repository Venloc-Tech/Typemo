import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";

/**
 * How the rows of a result map back to code names (Mongoose H14). `schema`: the rows (or the values of a field)
 * are stored documents of that schema in database names — translate them with `DbNames.toCode`;
 * `undefined`: the names are the ones the pipeline gave (after `$group`, a computed `$replaceRoot`, …).
 * `fields`: fields added by the pipeline whose values have their own shape (`$lookup.as`, `$facet` branches).
 *
 * @example
 * ```ts
 * const shape: ResultShape = { schema: userSchema, fields: new Map() };
 * ```
 */
export interface ResultShape {
  /** The schema the rows are stored documents of, or `undefined` for names the pipeline gave. */
  readonly schema: CompiledSchema | undefined;
  /** The shapes of the fields the pipeline added. */
  readonly fields: ReadonlyMap<string, ResultShape>;
}
