import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { HookFunction } from "../schema/metadata/metadata-types.ts";
import type { HookEvent, HookPhase } from "./hook-events.ts";

/**
 * The single place that reads and runs hooks.
 *
 * Hooks live in the `HookTable` of a compiled schema (class hooks, base class first in source order, then plugin
 * hooks, by event and phase), built once by the schema compiler. Every path reads it through this class: the
 * pipeline steps, the document writes, document initialisation and subdocuments. Mongoose kept three copies that
 * disagreed (`schema.s.hooks`, `model.hooks`, `model._middleware`), so `insertMany`, `bulkWrite` and `bulkSave`
 * each read a different one.
 */
export class HookRegistry {
  /**
   * The hooks of an event and phase in run order.
   *
   * @param schema - The compiled schema that owns the hook table.
   * @param event - The hook event.
   * @param phase - The phase of the event.
   * @returns The hooks in run order (an empty list when there are none).
   */
  static list(schema: CompiledSchema, event: HookEvent, phase: HookPhase): readonly HookFunction[] {
    return schema.hooks[event][phase];
  }

  /**
   * Tells whether an event has a hook in any phase.
   *
   * @param schema - The compiled schema that owns the hook table.
   * @param event - The hook event.
   * @returns `true` when at least one `pre`, `post` or `postError` hook exists.
   */
  static has(schema: CompiledSchema, event: HookEvent): boolean {
    const phases = schema.hooks[event];
    return phases.pre.length > 0 || phases.post.length > 0 || phases.postError.length > 0;
  }

  /**
   * Tells whether the schema has a hook of an operation event (query, model or aggregate, not `document.*`, which
   * the document layer runs itself) in a phase. The pipeline steps use it to decide whether they are needed.
   *
   * @param schema - The compiled schema that owns the hook table.
   * @param phase - The phase to look at.
   * @returns `true` when any operation event has a hook in `phase`.
   */
  static hasOperationHooks(schema: CompiledSchema, phase: HookPhase): boolean {
    return Object.entries(schema.hooks).some(
      ([event, phases]) =>
        !event.startsWith("document.") && (phases as Record<HookPhase, readonly unknown[]>)[phase].length > 0,
    );
  }

  /**
   * Runs hooks one after another with `self` as `this`, awaiting each. They never run in parallel: Mongoose ran
   * the pre hooks of `bulkSave` in parallel, which made their order unpredictable.
   *
   * @param hooks - The hooks in run order.
   * @param self - The value bound as `this` in every hook.
   * @param args - The arguments passed to every hook.
   * @param stop - Checked after each hook; returning `true` ends the run early (a pre hook skipped the operation).
   * @param after - Runs after each hook that did not stop the run, so an operation changed by a pre hook is
   * prepared again before the next hook sees it.
   * @returns A promise that settles when the run ends.
   * @throws Whatever a hook throws; the run stops at that hook.
   */
  static async run(
    hooks: readonly HookFunction[],
    self: unknown,
    args: readonly unknown[],
    stop: () => boolean = () => false,
    after?: () => void | Promise<void>,
  ): Promise<void> {
    for (const hook of hooks) {
      await (hook as (this: unknown, ...rest: unknown[]) => unknown).apply(self, [...args]);
      if (stop()) return;
      if (after !== undefined) await after();
    }
  }

  /**
   * Runs the hooks of a document event.
   *
   * @param schema - The compiled schema that owns the hook table.
   * @param event - The document hook event.
   * @param phase - The phase of the event.
   * @param document - The document or subdocument, bound as `this`.
   * @param args - The arguments passed to every hook.
   * @returns A promise when there are hooks to run, `undefined` when there are none (so callers skip the `await`).
   */
  static document(
    schema: CompiledSchema,
    event: HookEvent,
    phase: HookPhase,
    document: object,
    args: readonly unknown[],
  ): Promise<void> | undefined {
    const hooks = HookRegistry.list(schema, event, phase);
    return hooks.length === 0 ? undefined : HookRegistry.run(hooks, document, args);
  }
}
