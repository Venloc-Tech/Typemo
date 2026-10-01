/*
 * What the TC39 package refuses at run time. A decorator that is misapplied despite the types
 * (a cast, plain JS, a `#private` field) must throw `ConfigurationError` — never be silently ignored.
 */
import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@venloc/typemo";
import { Prop, Schema } from "../../src/index.ts";

/** `unknown`-typed view of the decorator: these tests check the run-time guard, not the types. */
const UntypedProp = Prop as unknown as (...args: unknown[]) => (value: unknown, context: unknown) => void;

describe("TC39 @Prop: run-time refusals", () => {
  test("@Prop on a #private field throws ConfigurationError", () => {
    expect(() => {
      @Schema()
      class User {
        @UntypedProp(() => String) #token!: string;
        read(): string {
          return this.#token;
        }
      }
      return User;
    }).toThrow(ConfigurationError);
  });

  test("@Prop on a static field throws ConfigurationError", () => {
    expect(() => {
      @Schema()
      class User {
        @UntypedProp(() => String) static label = "x";
      }
      return User;
    }).toThrow(ConfigurationError);
  });

  test("@Prop on a method throws ConfigurationError", () => {
    expect(() => {
      @Schema()
      class User {
        @UntypedProp(() => String) greet(): string {
          return "hi";
        }
      }
      return User;
    }).toThrow(ConfigurationError);
  });

  test("@Prop on a getter throws ConfigurationError (getters are virtuals)", () => {
    expect(() => {
      @Schema()
      class User {
        @UntypedProp(() => String) get upper(): string {
          return "";
        }
      }
      return User;
    }).toThrow(ConfigurationError);
  });

  test("@Prop without a type thunk throws ConfigurationError", () => {
    expect(() => {
      @Schema()
      class User {
        @UntypedProp() name!: string;
      }
      return User;
    }).toThrow(ConfigurationError);
  });

  test("@Prop with a bare constructor instead of a thunk throws ConfigurationError", () => {
    expect(() => {
      @Schema()
      class User {
        @UntypedProp(String) name!: string;
      }
      return User;
    }).toThrow(ConfigurationError);
  });

  test("Symbol.metadata is polyfilled on import", () => {
    expect(typeof Symbol.metadata).toBe("symbol");
    @Schema()
    class User {
      @Prop(() => String) name!: string;
    }
    expect(Object.hasOwn(User, Symbol.metadata)).toBe(true);
  });
});
