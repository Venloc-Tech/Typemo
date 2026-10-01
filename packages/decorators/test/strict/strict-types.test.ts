/*
 * What the TC39 package checks at compile time. Each invalid class is declared inside a function that the
 * type test never calls, so a runtime refusal (private field, wrong member kind) does not break this file;
 * `strict-runtime.test.ts` calls the same shapes and expects the `ConfigurationError`. Every
 * `@ts-expect-error` names the rule that must fail.
 */
import { describe, expect, test } from "bun:test";
import type { TenantField } from "@venloc/typemo";
import { Prop, Schema, Tenant } from "../../src/index.ts";

describe("TC39 @Prop: compile-time strictness", () => {
  test("positive: options that fit the field type compile", () => {
    @Schema()
    class User {
      @Prop(() => String, { required: true, trim: true }) name!: string;
      @Prop(() => Number, { min: 0 }) age?: number;
    }
    expect(typeof User).toBe("function");
  });

  test("options are checked against Value of ClassFieldDecoratorContext<This, Value>", () => {
    const invalid = (): void => {
      @Schema()
      class User {
        // @ts-expect-error — `() => Number` does not produce the field type `string`
        @Prop(() => Number) name!: string;
        // @ts-expect-error — `trim` is a String option, the field is a number
        @Prop(() => Number, { trim: true }) age!: number;
        // @ts-expect-error — `min` is not an option of a string field
        @Prop(() => String, { min: 1 }) nick!: string;
        // @ts-expect-error — unknown option key: typo `requierd`
        @Prop(() => String, { requierd: true }) email!: string;
        // @ts-expect-error — `nullable` without `| null` in the field type
        @Prop(() => String, { nullable: true }) title!: string;
      }
      void User;
    };
    expect(typeof invalid).toBe("function");
  });

  test("the runtime type thunk `() => T` is required (TC39 has no design:type)", () => {
    const invalid = (): void => {
      @Schema()
      class User {
        // @ts-expect-error — no type thunk: TC39 cannot infer the runtime type of a field
        @Prop() name!: string;
        // @ts-expect-error — a bare constructor, not a thunk `() => String`
        @Prop(String) nick!: string;
      }
      void User;
    };
    expect(typeof invalid).toBe("function");
  });

  test("private and #private fields cannot be schema fields (TC39 sees both)", () => {
    const invalid = (): void => {
      @Schema()
      class User {
        // @ts-expect-error — TS `private` field (not in `keyof This`)
        @Prop(() => String) private secret!: string;
        // @ts-expect-error — ECMAScript `#private` field (`context.private: true`)
        @Prop(() => String) #token!: string;
        // @ts-expect-error — `protected` field
        @Prop(() => String) protected note!: string;
        read(): string {
          return this.secret + this.#token + this.note;
        }
      }
      void User;
    };
    expect(typeof invalid).toBe("function");
  });

  test("@Prop on a wrong member kind is a type error (the context kind is typed)", () => {
    const invalid = (): void => {
      @Schema()
      class User {
        // @ts-expect-error — static field (ClassFieldDecoratorContext & { static: true })
        @Prop(() => String) static label: string;
        // @ts-expect-error — method (ClassMethodDecoratorContext)
        @Prop(() => String) greet(): string {
          return "hi";
        }
        // @ts-expect-error — getter (ClassGetterDecoratorContext): getters are virtuals
        @Prop(() => String) get upper(): string {
          return "";
        }
      }
      void User;
    };
    expect(typeof invalid).toBe("function");
  });

  test("@Schema on a non-class member is a type error", () => {
    const invalid = (): void => {
      class User {
        // @ts-expect-error — `@Schema` is a class decorator, not a field decorator
        @Schema() name!: string;
      }
      void User;
    };
    expect(typeof invalid).toBe("function");
  });
});

describe("TC39 @Tenant(): compile-time strictness", () => {
  test("@Tenant() sits only on a field declared TenantField<T>", () => {
    const invalid = (): void => {
      @Schema({ tenant: true })
      class Note {
        @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
        // @ts-expect-error — @Tenant "title": declare the field as TenantField<T>
        @Prop(() => String) @Tenant() title!: string;
      }
      void Note;
    };
    expect(typeof invalid).toBe("function");
  });
});
