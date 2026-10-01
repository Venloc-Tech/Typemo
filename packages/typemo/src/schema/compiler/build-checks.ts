import { ConfigurationError } from "../../errors/configuration-error.ts";
import type { ClassRef } from "../metadata/metadata-types.ts";

/**
 * Accessors of a class (getters and setters on its prototype chain).
 *
 * @example
 * ```ts
 * const info: AccessorInfo = { key: "fullName", settable: false };
 * ```
 */
export interface AccessorInfo {
  /** The accessor name. */
  readonly key: string;
  /** `true` when the accessor has a setter. */
  readonly settable: boolean;
}

/**
 * Class-level build checks that need the class itself rather than its metadata: the constructor,
 * field initializers and name clashes with methods and accessors. Every failure is a
 * `ConfigurationError` naming the class and the field.
 */
export class BuildChecks {
  /**
   * Constructs the class without arguments. The instances are used for the build checks only
   * (initializers, determinism).
   *
   * @param target - The entity class.
   * @returns A new instance.
   * @throws {ConfigurationError} When the constructor declares parameters or throws.
   */
  static construct(target: ClassRef): object {
    if (target.length > 0) {
      throw new ConfigurationError(
        `${target.name}: the constructor takes ${target.length} argument(s); an entity is created by Typemo without arguments`,
      );
    }
    try {
      return Reflect.construct(target, []) as object;
    } catch (error) {
      throw new ConfigurationError(`${target.name}: the constructor threw when called without arguments`, {
        cause: error,
      });
    }
  }

  /**
   * Hydration plans are taken from ONE instance of the class (which own properties the constructor
   * leaves, which fields a plain assignment may fill), so every instance must start the same.
   * Two instances made without arguments must have the same own keys in the same order, each `undefined` in both
   * or in neither, with the same kind (data or accessor) and attributes. Values other than `undefined` may differ.
   *
   * @param target - The entity class, named in the error text.
   * @param first - One instance made without arguments.
   * @param second - Another instance made without arguments.
   * @throws {ConfigurationError} When the two instances differ in shape.
   */
  static deterministic(target: ClassRef, first: object, second: object): void {
    const difference = BuildChecks.difference(first, second);
    if (difference === undefined) return;
    throw new ConfigurationError(
      `${target.name}: the constructor must behave the same for every instance: ${difference}; Typemo prepares hydration from one instance, so an entity constructor must not decide its own properties per instance`,
    );
  }

  /**
   * Finds the first shape difference between two instances.
   *
   * @param first - One instance.
   * @param second - Another instance.
   * @returns A description of the difference, or `undefined` when the shapes are the same.
   */
  private static difference(first: object, second: object): string | undefined {
    const keys = Reflect.ownKeys(first);
    const other = Reflect.ownKeys(second);
    const name = (key: string | symbol): string => (typeof key === "symbol" ? key.toString() : `"${key}"`);
    if (keys.length !== other.length || keys.some((key, index) => key !== other[index])) {
      return `one instance has the own properties [${keys.map(name).join(", ")}], another [${other.map(name).join(", ")}]`;
    }
    for (const key of keys) {
      const a = Object.getOwnPropertyDescriptor(first, key) as PropertyDescriptor;
      const b = Object.getOwnPropertyDescriptor(second, key) as PropertyDescriptor;
      if ("value" in a !== "value" in b) return `the own property ${name(key)} is a data property on one instance only`;
      if ("value" in a && (a.value === undefined) !== (b.value === undefined)) {
        return `the own property ${name(key)} is undefined on one instance only`;
      }
      for (const attribute of ["writable", "enumerable", "configurable"] as const) {
        if (a[attribute] !== b[attribute]) return `the own property ${name(key)} differs in "${attribute}"`;
      }
    }
    return undefined;
  }

  /**
   * A schema field with a value right after construction is an initializer (`score = 5`) or a
   * constructor assignment: a build error, use `default`. Own properties that are `undefined`
   * are artifacts of define semantics (`useDefineForClassFields: true`, TC39) and are fine.
   * Limitation: `x = undefined` cannot be told apart from a plain declaration.
   *
   * @param target - The entity class, named in the error text.
   * @param instance - An instance made without arguments.
   * @param keys - The schema field names to check.
   * @throws {ConfigurationError} When a schema field has a value right after construction.
   */
  static initializers(target: ClassRef, instance: object, keys: readonly string[]): void {
    const set = keys.filter(
      (key) => Object.hasOwn(instance, key) && (instance as Record<string, unknown>)[key] !== undefined,
    );
    if (set.length > 0) {
      throw new ConfigurationError(
        `${target.name}: field(s) ${set.map((key) => `"${key}"`).join(", ")} get a value from an initializer or the constructor; use the "default" option — service fields are filled by Typemo`,
      );
    }
  }

  /**
   * An own data property of an instance that is not a schema field or virtual is a property without `@Prop`:
   * the model type has it, but Typemo never stores, casts or loads it. Only string-keyed, enumerable own DATA
   * properties count: methods and accessors live on the prototype, `declare` fields create nothing, symbols and
   * `#private` fields are not data of the document, an accessor defined on the instance is not data, and a
   * non-enumerable property (`Object.defineProperty` without `enumerable`) is a deliberate hidden helper.
   *
   * @param target - The entity class, named in the error text.
   * @param instance - An instance made without arguments.
   * @param keys - The schema field and virtual names.
   * @throws {ConfigurationError} When the instance has an own data property that is not a schema field.
   */
  static undeclared(target: ClassRef, instance: object, keys: readonly string[]): void {
    const known = new Set(keys);
    const extra = Object.getOwnPropertyNames(instance).filter((key) => {
      if (known.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(instance, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true;
    });
    if (extra.length === 0) return;
    const list = extra.map((key) => `"${key}"`).join(", ");
    throw new ConfigurationError(
      `${target.name}: property ${list} has no @Prop, so it is not a field of the schema (never stored, cast or loaded); decorate it with @Prop, declare it with "declare", or make it a getter or a method`,
    );
  }

  /**
   * Getters/setters of the class and its ancestors (native virtuals).
   *
   * @param target - The entity class.
   * @returns One entry per accessor name; a subclass accessor wins over the base one.
   */
  static accessors(target: ClassRef): AccessorInfo[] {
    const found = new Map<string, AccessorInfo>();
    for (
      let proto: unknown = target.prototype;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto)
    ) {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
        if (key === "constructor" || found.has(key)) continue;
        if (descriptor.get !== undefined || descriptor.set !== undefined) {
          found.set(key, { key, settable: descriptor.set !== undefined });
        }
      }
    }
    return [...found.values()];
  }

  /**
   * Fields must not collide with methods or accessors of the class (the field would be shadowed or shadow them).
   *
   * @param target - The entity class.
   * @param keys - The schema field names.
   * @throws {ConfigurationError} When a field name is also a method or an accessor of the class.
   */
  static nameClashes(target: ClassRef, keys: readonly string[]): void {
    for (
      let proto: unknown = target.prototype;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto)
    ) {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        if (descriptor === undefined) continue;
        const what = descriptor.get !== undefined || descriptor.set !== undefined ? "an accessor" : "a method";
        throw new ConfigurationError(`${target.name}: field "${key}" is also ${what} of the class`);
      }
    }
  }
}
