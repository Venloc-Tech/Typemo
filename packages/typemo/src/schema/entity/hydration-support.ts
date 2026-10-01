import type { CompiledSchema } from "../compiler/compiled-schema.ts";

/**
 * The schema side of hydration (the document layer uses it): an entity is
 * created with `new C()`, so methods, getters and `#private` work, and then the own properties of
 * schema paths that are `undefined` are deleted. Those are artifacts of define semantics
 * (`useDefineForClassFields: true` in the user's project, TC39 decorators); without them the
 * accessors of the prototype are reachable again and `"field" in doc` is honest. The data is
 * assigned afterwards by the caller.
 *
 * Independent of the user's `useDefineForClassFields`: the result is the same object shape either way
 * (tested in both configurations).
 */
export class HydrationSupport {
  /**
   * Creates a fresh instance of the schema's class with no own `undefined` schema properties.
   *
   * @param schema - The compiled schema whose class is instantiated.
   * @returns The new instance, ready to be filled by the caller.
   */
  static instantiate<T extends object>(schema: CompiledSchema): T {
    const instance = Reflect.construct(schema.target, []) as T;
    HydrationSupport.clean(schema, instance);
    return instance;
  }

  /**
   * Deletes the own `undefined` properties of schema fields and virtuals (never a value).
   *
   * @param schema - The compiled schema that lists the fields and virtuals.
   * @param instance - The instance to clean; it is modified in place.
   */
  static clean(schema: CompiledSchema, instance: object): void {
    const keys = [...schema.fields.map((field) => field.key), ...schema.virtuals.map((virtual) => virtual.key)];
    for (const key of keys) {
      if (Object.hasOwn(instance, key) && (instance as Record<string, unknown>)[key] === undefined) {
        delete (instance as Record<string, unknown>)[key];
      }
    }
  }
}
