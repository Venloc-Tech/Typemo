import { describe, expect, test } from "bun:test";
import { Entity, HydrationSupport, Prop, Schema, SchemaCompiler } from "../../../src/internal.ts";
import { Person } from "../../fixtures/schema-entities.ts";

/* Hydration support — `new C()`, then own `undefined` schema properties are deleted. */

describe("HydrationSupport", () => {
  test("instantiate: an instance of the class, methods and getters work, no own schema keys", () => {
    const person = HydrationSupport.instantiate<Person>(SchemaCompiler.compile(Person));
    expect(person).toBeInstanceOf(Person);
    expect(Object.keys(person)).toEqual([]);
    expect("email" in person).toBe(false);
  });

  test("clean removes own undefined schema properties (define-semantics artifacts), keeps other own properties", () => {
    @Schema()
    class Defined extends Entity {
      @Prop(() => String) name?: string;
      #secret = 1;
      read(): number {
        return this.#secret;
      }
    }
    const schema = SchemaCompiler.compile(Defined);
    const instance = new Defined() as Defined & Record<string, unknown>;
    /* What `useDefineForClassFields: true` would have created: */
    Object.defineProperty(instance, "name", { value: undefined, enumerable: true, configurable: true, writable: true });
    instance.helper = undefined;
    HydrationSupport.clean(schema, instance);
    expect(Object.hasOwn(instance, "name")).toBe(false);
    expect(Object.hasOwn(instance, "helper")).toBe(true); // not a schema field: not Typemo's business
    expect(instance.read()).toBe(1); // #private works: the object was constructed, not Object.create'd
  });
});
