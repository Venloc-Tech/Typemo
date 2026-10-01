import { ConfigurationError } from "../../errors/configuration-error.ts";
import type { DocumentHookEvent, HookArgs, HookEvent, HookPhase, HookThisOf } from "../../hooks/hook-events.ts";
import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import type { ClassRef, HookFunction } from "../metadata/metadata-types.ts";
import type { HookCheck } from "./class-checks.ts";
import { DecoratorGuard } from "./decorator-guard.ts";

/**
 * A hook method's type for events `E` of entity `T` in phase `P`. A document hook's `this` is left open here
 * (`never` accepts every declared `this`): it may be the hydrated document, the class or a subdocument, and
 * `HookCheck` checks which one was declared.
 *
 * @example
 * ```ts
 * type BeforeSave = HookMethod<"document.save", User, "pre">;
 * ```
 */
export type HookMethod<E, T, P extends HookPhase> = (
  this: [HookEventsOf<E>] extends [DocumentHookEvent] ? never : HookThisOf<E, T>,
  ...args: HookArgs<P, E, T>
) => unknown;

/**
 * The events of a hook registration (one or a list).
 *
 * @example
 * ```ts
 * type A = HookEventsOf<"document.save">; // "document.save"
 * ```
 */
type HookEventsOf<E> = E extends readonly (infer U)[] ? U : E;

/**
 * The method decorator returned by `@Pre`/`@Post`/`@PostError`; it checks the method signature
 * against the events it is registered for.
 *
 * @example
 * ```ts
 * const beforeSave: HookDecorator<"document.save", "pre"> = Pre("document.save");
 * ```
 */
export type HookDecorator<E, P extends HookPhase> = <T extends object, K extends string, M extends HookMethod<E, T, P>>(
  target: T,
  key: K,
  descriptor: TypedPropertyDescriptor<M> & HookCheck<E, T, M, P>,
) => void;

/**
 * Builds the decorator factory of one hook phase.
 *
 * @param phase - The phase the decorated method runs in.
 * @returns A factory taking the event or the events the method is registered for.
 * @throws {ConfigurationError} From the returned decorator, when the method is static or when mixed
 * with TC39 decorators.
 */
const hook =
  <P extends HookPhase>(phase: P) =>
  <const E extends HookEvent | readonly [HookEvent, ...HookEvent[]]>(events: E): HookDecorator<E, P> => {
    const decorate = (target: object, key: string | symbol, descriptor: PropertyDescriptor): void => {
      DecoratorGuard.assertLegacy(`@${phase === "pre" ? "Pre" : phase === "post" ? "Post" : "PostError"}`, key);
      if (typeof target === "function") {
        throw new ConfigurationError(`${target.name}: a hook must be an instance method, "${String(key)}" is static`);
      }
      const owner = (target as { constructor: ClassRef }).constructor;
      MetadataBuilder.for(owner).addHook(phase, events, descriptor?.value as HookFunction, String(key));
    };
    return decorate as HookDecorator<E, P>;
  };

/**
 * Runs the method before the event. Events name their scope: `document.save`, `query.updateMany`,
 * `model.insertMany`, `aggregate`. For document events `this` is the document or, when the class is embedded in
 * another, the subdocument: declare `this: HookThis<"document.save", User>` (`HydratedDoc<User> | Subdocument<User>`),
 * use `$isNew()`/`$isModified()` on both and narrow with `if (this.$isRoot())` for the root-only methods; a
 * declared `this: HydratedDoc<User>` alone does not compile. For the other events `this` is the operation context
 * (declared explicitly: `this: OperationHookContext<User>`).
 *
 * `document.save` hooks run on EVERY `$save()`, also when nothing changed (then nothing is sent, but the hooks and
 * the validation still run). To act only on a real change, exit early with `this.$isModified()`:
 * `if (!this.$isModified()) return;`.
 *
 * An operation hook (`query.*`, `model.*`, `aggregate`) runs only for the operations of a MODEL of the class. On a
 * class used only as a subdocument (embedded in another class, never `connection.model(Class)`) it never runs: the
 * operations belong to the model of the outer class, and its own hooks run there. Nothing reports it: declare
 * operation hooks on the class of the model.
 *
 * @example
 * ```ts
 * @Pre("document.save")
 * normalize(this: User): void { this.email = this.email.toLowerCase(); }
 * ```
 */
export const Pre = hook("pre");

/**
 * Runs the method after the event succeeded; receives the result.
 *
 * @example
 * ```ts
 * @Post("document.save")
 * audit(this: User): void { ... }
 * ```
 */
export const Post = hook("post");

/**
 * Runs the method when the event failed (instead of `@Post`); receives the error. It is a separate
 * decorator so that the error argument is typed.
 *
 * @example
 * ```ts
 * @PostError("document.save")
 * report(this: User, error: Error): void { ... }
 * ```
 */
export const PostError = hook("postError");
