import type { HookMethod } from "@venloc/typemo";
import { ConfigurationError } from "@venloc/typemo";
import type { HookCheck, HookEvent, HookFunction, HookPhase } from "@venloc/typemo/adapters";
import { Tc39Metadata } from "./tc39-metadata.ts";

/**
 * The decorator returned by `@Pre`/`@Post`/`@PostError` (TC39 method decorator).
 *
 * @example
 * ```ts
 * const decorator: Tc39HookDecorator<"document.save", "pre"> = Pre("document.save");
 * ```
 */
export type Tc39HookDecorator<E, P extends HookPhase> = <This, M extends HookMethod<E, This, P>>(
  value: M & HookCheck<E, This, M, P>,
  /*
   * Not `ClassMethodDecoratorContext<This, M>`: its `this: This` constraint rejects operation hooks, whose
   * `this` is `OperationHookContext`. The literal `static: false` refuses static hooks at compile time.
   */
  context: HookContext & HookOwner<This>,
) => void;

/**
 * The part of a method decorator context a hook reads.
 *
 * @example
 * ```ts
 * const context: HookContext = { kind: "method", static: false, metadata: {} };
 * ```
 */
interface HookContext {
  /** Always a method: hooks are instance methods. */
  readonly kind: "method";
  /** Always `false`: static hooks are refused at compile time. */
  readonly static: false;
  /** The metadata object shared by all decorators of the class (typed as the compiler's library has it: without `esnext.decorators` it may be `undefined`). */
  readonly metadata: DecoratorMetadata;
}

/**
 * Infers the class instance type from the context (`access.has` is a method, so the check is bivariant).
 *
 * @example
 * ```ts
 * const owner: HookOwner<User> = { access: { has: (object) => object instanceof User } };
 * ```
 */
interface HookOwner<This> {
  /** Access to the decorated member; only `has` is used, to infer `This`. */
  readonly access: { has(object: This): boolean };
}

const PHASE_NAMES = { pre: "@Pre", post: "@Post", postError: "@PostError" } as const;

/**
 * Builds the decorator factory of one hook phase.
 *
 * @param phase - The hook phase (`pre`, `post` or `postError`).
 * @returns A factory taking the event or events and returning the method decorator.
 * @throws {ConfigurationError} When the decorated member is not a string-named instance method.
 */
const hook =
  <P extends HookPhase>(phase: P) =>
  <const E extends HookEvent | readonly [HookEvent, ...HookEvent[]]>(events: E): Tc39HookDecorator<E, P> => {
    const decorator = PHASE_NAMES[phase];
    const decorate = (value: unknown, context: unknown): void => {
      const ctx = Tc39Metadata.context(decorator, context);
      if (ctx.kind !== "method" || typeof ctx.name !== "string") {
        throw new ConfigurationError(`${decorator}: a hook must be a string-named instance method, got ${ctx.kind}`);
      }
      Tc39Metadata.record(decorator, ctx, {
        kind: "hook",
        key: ctx.name,
        phase,
        events,
        fn: value as HookFunction,
      });
    };
    return decorate as Tc39HookDecorator<E, P>;
  };

/**
 * Runs the method before the event (same events and `this` as the core `@Pre`: for document events the document or,
 * when the class is embedded, the subdocument — `HookThis<"document.save", User>`, narrowed by `this.$isRoot()`).
 * An operation hook (`query.*`, `model.*`, `aggregate`) runs only for the operations of a model of the class: on a
 * class used only as a subdocument it never runs, and nothing reports it.
 *
 * @param events - The event or events to hook.
 * @returns A TC39 method decorator.
 */
export const Pre = hook("pre");

/**
 * Runs the method after the event succeeded; receives the result.
 *
 * @param events - The event or events to hook.
 * @returns A TC39 method decorator.
 */
export const Post = hook("post");

/**
 * Runs the method when the event failed (instead of `@Post`); receives the error.
 *
 * @param events - The event or events to hook.
 * @returns A TC39 method decorator.
 */
export const PostError = hook("postError");
