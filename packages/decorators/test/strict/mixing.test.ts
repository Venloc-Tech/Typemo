/*
 * One decorator package per project. Mixing is not possible through the compiler flag
 * (`experimentalDecorators` is global), but a class can still get legacy metadata by a direct call of the
 * core decorator (plain JS, a shared library built in the other mode, inheritance across such modules).
 * When both kinds of metadata meet on one class or hierarchy, compiling the schema must fail with a clear
 * `ConfigurationError` rather than merge the two silently.
 */
import { describe, expect, test } from "bun:test";
import { ConfigurationError, Prop as LegacyProp, Schema as LegacySchema } from "@venloc/typemo";
import { SchemaCompiler } from "../../../typemo/src/internal.ts";
import { Prop, Schema } from "../../src/index.ts";

/*
 * The legacy decorators are applied by hand: this package compiles without `experimentalDecorators`.
 */

/**
 * A legacy field decorator, as a transpiler would call it.
 *
 * @example
 * ```ts
 * const decorate: LegacyField = (target, key) => void [target, key];
 * ```
 */
type LegacyField = (target: object, key: string) => void;

/**
 * A legacy class decorator, as a transpiler would call it.
 *
 * @example
 * ```ts
 * const decorate: LegacyClass = (target) => void target;
 * ```
 */
type LegacyClass = (target: abstract new () => object) => void;

/**
 * Applies a legacy field decorator by hand.
 *
 * @param target - The class prototype.
 * @param key - The field name.
 * @param decorator - The legacy decorator, typed loosely on purpose.
 */
const legacyField = (target: object, key: string, decorator: unknown): void => (decorator as LegacyField)(target, key);

/**
 * Applies a legacy class decorator by hand.
 *
 * @param target - The class.
 * @param decorator - The legacy decorator, typed loosely on purpose.
 */
const legacyClass = (target: abstract new () => object, decorator: unknown): void => (decorator as LegacyClass)(target);

/** The words the mixing error message must contain. */
const MIXING = /legacy|TC39|mix/i;

describe("legacy and TC39 metadata on one class", () => {
  test("TC39 fields plus a legacy field on the same class → ConfigurationError", () => {
    const run = (): unknown => {
      @Schema()
      class Mixed {
        @Prop(() => String) name!: string;
        age!: number;
      }
      legacyField(
        Mixed.prototype,
        "age",
        LegacyProp(() => Number),
      );
      return SchemaCompiler.compile(Mixed);
    };
    expect(run).toThrow(ConfigurationError);
    expect(run).toThrow(MIXING);
  });

  test("a TC39 class extending a legacy-decorated base → ConfigurationError", () => {
    const run = (): unknown => {
      class Base {
        createdAt!: Date;
      }
      legacyField(
        Base.prototype,
        "createdAt",
        LegacyProp(() => Date),
      );
      legacyClass(Base, LegacySchema());

      @Schema()
      class Child extends Base {
        @Prop(() => String) name!: string;
      }
      return SchemaCompiler.compile(Child);
    };
    expect(run).toThrow(ConfigurationError);
    expect(run).toThrow(MIXING);
  });

  test("a legacy @Schema on a class with TC39 fields → ConfigurationError", () => {
    const run = (): unknown => {
      class Mixed {
        @Prop(() => String) name!: string;
      }
      legacyClass(Mixed, LegacySchema());
      return SchemaCompiler.compile(Mixed);
    };
    expect(run).toThrow(ConfigurationError);
    expect(run).toThrow(MIXING);
  });

  test("control: a pure TC39 class compiles", () => {
    @Schema()
    class Pure {
      @Prop(() => String) name!: string;
    }
    expect(() => SchemaCompiler.compile(Pure)).not.toThrow();
  });
});

describe("a TC39 decorator applied in legacy mode", () => {
  test("@Prop called with legacy arguments (prototype, key) → ConfigurationError", () => {
    class Target {
      name!: string;
    }
    /* cast: call the TC39 decorator the legacy way on purpose — it must refuse */
    const decorator = Prop(() => String) as unknown as (target: object, key: string) => void;
    expect(() => decorator(Target.prototype, "name")).toThrow(ConfigurationError);
    expect(() => decorator(Target.prototype, "name")).toThrow(MIXING);
  });

  test("@Schema called with a legacy class argument only → ConfigurationError", () => {
    class Target {}
    /* cast: call the TC39 class decorator the legacy way on purpose — it must refuse */
    const decorator = Schema() as unknown as (target: unknown) => void;
    expect(() => decorator(Target)).toThrow(ConfigurationError);
  });
});
