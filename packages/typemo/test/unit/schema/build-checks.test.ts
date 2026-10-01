import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  type ClassRef,
  ConfigurationError,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  MetadataBuilder,
  Pre,
  Prop,
  Schema,
  SchemaCompiler,
  Spec,
  Tenant,
  type TenantField,
  Virtual,
  type VirtualRef,
} from "../../../src/internal.ts";

/*
 * Every build-time check is a ConfigurationError with a readable message naming the class and the field. Invalid
 * declarations are written through MetadataBuilder (the untyped path plugins and JS callers take) when the
 * decorator's types would already refuse them; the type tests cover those.
 */

/** The `ConfigurationError` that compiling `target` throws; anything else fails the test. */
const compileError = (target: ClassRef): ConfigurationError => {
  try {
    SchemaCompiler.compile(target);
  } catch (error) {
    if (error instanceof ConfigurationError) return error;
    throw error;
  }
  throw new Error(`${target.name} compiled without an error`);
};

/** A fresh @Schema class with fields added through the builder. */
const schemaWith = (
  name: string,
  fields: readonly [string, () => unknown, Record<string, unknown>?][],
  options: Record<string, unknown> = {},
  tenantFields: readonly string[] = [],
): ClassRef => {
  const target = { [name]: class extends Entity {} }[name] as ClassRef;
  const builder = MetadataBuilder.for(target);
  for (const [key, type, fieldOptions] of fields) builder.addField(key, type, fieldOptions ?? {});
  for (const key of tenantFields) builder.markTenantField(key);
  builder.setSchema(options);
  return target;
};

const TYPE_CASES: readonly (readonly [string, () => unknown, RegExp])[] = [
  ["Set", () => Set, /Set is not supported/],
  ["Map without value type", () => Map, /a Map needs its value type: Spec.map\(X\)/],
  ["Array without element type", () => Array, /an array needs its element type/],
  ["empty array spec", () => [], /exactly one element type/],
  ["two-element array spec", () => [String, Number], /exactly one element type/],
  ["Object (Mixed)", () => Object, /Object \(Mixed\) is not supported/],
  ["class without @Schema", () => class Plain {}, /class Plain is not a schema; decorate it with @Schema\(\)$/],
  [
    "a thunk returning undefined (TDZ)",
    () => undefined,
    /returned undefined \(a class used before its declaration\?\)/,
  ],
  ["a union of the same type twice", () => Spec.union(String, String), /accept the same values/],
  [
    "a legacy BSON type (Code, D3)",
    () =>
      class Code {
        get _bsontype(): string {
          return "Code";
        }
      },
    /Code is not supported as a field type \(legacy BSON types\)/,
  ],
];

describe("types", () => {
  test.each(TYPE_CASES)("%s", (_name, type, message) => {
    const error = compileError(schemaWith("TypeCase", [["value", type as () => unknown]]));
    expect(error.message).toMatch(message);
    expect(error.message).toContain("TypeCase.value");
  });

  test("Long is refused (int64 is a bigint)", async () => {
    const { Long } = await import("mongodb");
    expect(compileError(schemaWith("LongCase", [["value", () => Long]])).message).toMatch(/use BigInt/);
  });

  test("a union of Number and Int32 is ambiguous", async () => {
    const { Int32 } = await import("mongodb");
    expect(compileError(schemaWith("UnionCase", [["value", () => Spec.union(Number, Int32)]])).message).toMatch(
      /union members number and int32 accept the same values/,
    );
  });

  test("a type thunk that throws is reported with its cause", () => {
    const error = compileError(
      schemaWith("ThrowCase", [
        [
          "value",
          () => {
            throw new ReferenceError("Cannot access 'X' before initialization");
          },
        ],
      ]),
    );
    expect(error.message).toMatch(/the type thunk threw/);
    expect(error.cause).toBeInstanceOf(ReferenceError);
  });

  test("a field without a type thunk is refused at the declaration", () => {
    class NoType {}
    /* cast: bypasses the type to test the runtime guard — no type thunk (JS caller) */
    expect(() => MetadataBuilder.for(NoType).addField("x", undefined as unknown as () => unknown)).toThrow(
      /the type is required on every field, as a thunk: @Prop\(\(\) => String\)$/,
    );
  });
});

describe("names", () => {
  test.each(["constructor", "prototype", "__proto__"])("%s is forbidden", (name) => {
    class Named {}
    expect(() => MetadataBuilder.for(Named).addField(name, () => String)).toThrow(/this name is forbidden$/);
  });

  test.each(["a.b", "$set", ""])("%j is not a field name", (name) => {
    class Named {}
    expect(() => MetadataBuilder.for(Named).addField(name, () => String)).toThrow(
      /cannot be empty, contain "." or start with "\$"/,
    );
  });

  test("a field declared twice in one class", () => {
    class Twice {}
    MetadataBuilder.for(Twice).addField("a", () => String);
    expect(() => MetadataBuilder.for(Twice).addField("a", () => String)).toThrow(/@Prop "a" is declared twice/);
  });

  test("a field that is also a method or an accessor of the class", () => {
    @Schema()
    class WithMethod {
      @Prop(() => String) name?: string;
      label(): string {
        return "";
      }
    }
    MetadataBuilder.for(WithMethod).addField("label", () => String);
    expect(compileError(WithMethod).message).toMatch(/field "label" is also a method of the class/);
  });

  test("@Prop on a static member, a method or an accessor is refused at the declaration", () => {
    /* cast: bypasses the type to test the runtime guard — @Prop on a static member/method/accessor */
    const decorate = Prop(() => String) as unknown as (
      target: object,
      key: string,
      descriptor?: PropertyDescriptor,
    ) => void;
    class Host {
      get x(): string {
        return "";
      }
    }
    expect(() => decorate(Host, "count")).toThrow(/static fields are not schema fields/);
    expect(() => decorate(Host.prototype, "x", Object.getOwnPropertyDescriptor(Host.prototype, "x"))).toThrow(
      /which is a method or an accessor/,
    );
  });
});

describe("classes", () => {
  test("a constructor with parameters (the type of @Schema refuses it too; this is the untyped path)", () => {
    class WithArgs {
      // biome-ignore lint/complexity/noUselessConstructor: the parameter is the point of the test.
      constructor(_name: string) {}
    }
    MetadataBuilder.for(WithArgs).addField("name", () => String);
    MetadataBuilder.for(WithArgs).setSchema({});
    expect(compileError(WithArgs).message).toMatch(
      /the constructor takes 1 argument\(s\); an entity is created by Typemo without arguments$/,
    );
  });

  test("a constructor that throws without arguments", () => {
    @Schema()
    class Throws {
      @Prop(() => String) name?: string;
      constructor() {
        throw new Error("needs config");
      }
    }
    const error = compileError(Throws);
    expect(error.message).toMatch(/the constructor threw when called without arguments$/);
    expect((error.cause as Error).message).toBe("needs config");
  });

  describe("the constructor behaves the same for every instance (hydration plans come from one instance)", () => {
    const deterministicError = /the constructor must behave the same for every instance:/;

    test("an own undefined property on some instances only", () => {
      let made = 0;
      @Schema()
      class Flaky {
        @Prop(() => String) name?: string;
        constructor() {
          /* Define semantics on odd instances only: the plan would skip `clean` where it is needed. */
          if (made++ % 2 === 0)
            Object.defineProperty(this, "name", {
              value: undefined,
              enumerable: true,
              writable: true,
              configurable: true,
            });
        }
      }
      const error = compileError(Flaky);
      expect(error.message).toMatch(deterministicError);
      expect(error.message).toMatch(/own properties \["name"\], another \[\]/);
    });

    test("a property undefined on one instance, set on another", () => {
      let made = 0;
      @Schema()
      class Random {
        @Prop(() => String) name?: string;
        declare cache: unknown;
        constructor() {
          Object.defineProperty(this, "cache", { value: made++ === 0 ? undefined : {}, writable: true });
        }
      }
      expect(compileError(Random).message).toMatch(/the own property "cache" is undefined on one instance only/);
    });

    test("an attribute that differs (read-only on one instance)", () => {
      let made = 0;
      @Schema()
      class Frozen {
        @Prop(() => String) name?: string;
        declare tag: string;
        constructor() {
          Object.defineProperty(this, "tag", {
            value: "t",
            enumerable: false,
            writable: made++ > 0,
            configurable: true,
          });
        }
      }
      expect(compileError(Frozen).message).toMatch(/the own property "tag" differs in "writable"/);
    });

    test("different values that are not undefined are fine; so is a deterministic constructor", () => {
      @Schema()
      class Stamped {
        @Prop(() => String) name?: string;
        declare stamp: number;
        constructor() {
          Object.defineProperty(this, "stamp", { value: Math.random() + 1, enumerable: false, writable: true });
        }
      }
      /* A non-enumerable own property is not data of the document: exempt from the "has no @Prop" check. */
      expect(SchemaCompiler.compile(Stamped).name).toBe("Stamped");
    });
  });

  test("a field initializer is a build error", () => {
    @Schema()
    class Initialized {
      /* The type check cannot see initializers; the build does (one `new C()`). */
      @Prop(() => Number) score: number = 5;
    }
    expect(compileError(Initialized).message).toMatch(
      /field\(s\) "score" get a value from an initializer or the constructor; use the "default" option — service fields are filled by Typemo/,
    );
  });

  test("a constructor assignment is caught the same way", () => {
    @Schema()
    class Assigned {
      @Prop(() => String) name?: string;
      constructor() {
        this.name = "x";
      }
    }
    expect(compileError(Assigned).message).toMatch(/"name" get a value/);
  });

  describe("an own data property without @Prop is a build error", () => {
    test("an initialized property without @Prop is named, with the reason", () => {
      @Schema()
      class WithCache extends Entity {
        @Prop(() => String) name?: string;
        cache = new Map<string, string>();
      }
      expect(compileError(WithCache).message).toBe(
        'WithCache: property "cache" has no @Prop, so it is not a field of the schema (never stored, cast or loaded); decorate it with @Prop, declare it with "declare", or make it a getter or a method',
      );
    });

    test("define semantics: a field declared without @Prop exists as an own undefined property", () => {
      @Schema()
      class Defined extends Entity {
        @Prop(() => String) login?: string;
        constructor() {
          super();
          /* What `useDefineForClassFields: true` emits for `nick?: string` without a decorator. */
          Object.defineProperty(this, "nick", {
            value: undefined,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }
      expect(compileError(Defined).message).toMatch(/^Defined: property "nick" has no @Prop/);
    });

    test("every such property is listed; a property assigned in the constructor counts too", () => {
      @Schema()
      class Two extends Entity {
        @Prop(() => String) name?: string;
        declare first: number;
        declare second: string;
        constructor() {
          super();
          this.first = 1;
          this.second = "s";
        }
      }
      expect(compileError(Two).message).toMatch(/^Two: property "first", "second" has no @Prop/);
    });

    test("methods, getters, setters, declare fields, symbols, #private, instance accessors and populate virtuals are fine", () => {
      const tag = Symbol("tag");
      @Schema()
      class Fine extends Entity {
        @Prop(() => String) first?: string;
        @Prop(() => String) last?: string;
        declare note: string;
        #secret = 1;
        [tag] = "t";
        @Virtual({ ref: () => Fine, localField: "_id", foreignField: "_id" })
        declare same: VirtualRef<Fine>;
        constructor() {
          super();
          Object.defineProperty(this, "computed", { get: () => this.#secret, enumerable: false });
        }
        get full(): string {
          return `${this.first ?? ""} ${this.last ?? ""}`;
        }
        set full(value: string) {
          this.first = value;
        }
        greet(): string {
          return `hi ${this.full}`;
        }
      }
      expect(SchemaCompiler.compile(Fine).name).toBe("Fine");
    });

    test("a non-enumerable own data property is exempt; the same property enumerable is not", () => {
      @Schema()
      class Hidden extends Entity {
        @Prop(() => String) name?: string;
        declare cache: Map<string, string>;
        constructor() {
          super();
          Object.defineProperty(this, "cache", { value: new Map(), writable: true });
        }
      }
      expect(SchemaCompiler.compile(Hidden).name).toBe("Hidden");
      @Schema()
      class Shown extends Entity {
        @Prop(() => String) name?: string;
        declare cache: Map<string, string>;
        constructor() {
          super();
          Object.defineProperty(this, "cache", { value: new Map(), writable: true, enumerable: true });
        }
      }
      expect(compileError(Shown).message).toMatch(/^Shown: property "cache" has no @Prop/);
    });
  });
});

describe("options", () => {
  test.each([
    ["an unknown option", () => String, { minlength: 3 }, /"minlength" is not an option of this field type/],
    ["a String option on a Number", () => Number, { trim: true }, /"trim" is not an option of this field type/],
    ["expires on a String", () => String, { expires: 5 }, /"expires" is not an option/],
    ["min > max", () => Number, { min: 5, max: 1 }, /"min" is greater than "max"/],
    ["min of the wrong type", () => Number, { min: "1" }, /"min"\/"max" must be number values/],
    ["minLength > maxLength", () => String, { minLength: 5, maxLength: 1 }, /"minLength" is greater than "maxLength"/],
    ["match with the g flag", () => String, { match: /a/g }, /stateful \(lastIndex\)/],
    [
      "lowercase and uppercase",
      () => String,
      { lowercase: true, uppercase: true },
      /"lowercase" and "uppercase" together/,
    ],
    ["an enum value of another type", () => String, { enum: ["a", 1] }, /the enum value 1 is not a value of the field/],
    ["an empty enum", () => String, { enum: [] }, /"enum" is empty/],
    ["a default of another type", () => Number, { default: "5" }, /the "default" value is not a value of the field/],
    [
      "default: null on a non-nullable field",
      () => String,
      { default: null },
      /"default: null" on a field that is not nullable/,
    ],
    ["an invalid dbName", () => String, { dbName: "a.b" }, /"dbName" must be a field name/],
    ["sparse without an index", () => String, { sparse: true, required: true }, /"sparse" needs "index" or "unique"/],
  ] as const)("%s", (_name, type, options, message) => {
    expect(compileError(schemaWith("OptionCase", [["value", type, options]])).message).toMatch(message);
  });

  test("dbName conflicts", () => {
    expect(
      compileError(
        schemaWith("AliasCase", [
          ["a", () => String, { dbName: "x" }],
          ["b", () => String, { dbName: "x" }],
        ]),
      ).message,
    ).toMatch(/fields "a" and "b" are both stored as "x" \(dbName conflict\)/);
    expect(
      compileError(
        schemaWith("AliasCase2", [
          ["a", () => String, { dbName: "b" }],
          ["b", () => String],
        ]),
      ).message,
    ).toMatch(/fields "a" and "b" are both stored as "b"/);
  });

  test.each(["toJSON", "toObject"])(
    "@Schema has no %s option (a JavaScript caller gets an error, not ignored defaults)",
    (option) => {
      const target = schemaWith(`NoDefaults_${option}`, [["name", () => String]], { [option]: { virtuals: true } });
      expect(compileError(target).message).toMatch(new RegExp(`no "${option}" option — pass serialization options`));
    },
  );

  test.each(["strict", "strictQuery", "timestamps", "versionKey", "pluralization"])(
    "@Schema has no %s option (an unknown key is an error, not an option that does nothing)",
    (option) => {
      const target = schemaWith(`UnknownOption_${option}`, [["name", () => String]], { [option]: false });
      expect(compileError(target).message).toMatch(
        new RegExp(`@Schema has no "${option}" option \\(the options are: collection, `),
      );
    },
  );

  test.each([false, "yes", 1, null])(
    "Spec.map options: nullable %p is a ConfigurationError, not read as absent",
    (value) => {
      /* as never: the type allows only { nullable: true }; this is the JavaScript caller. */
      const target = schemaWith("BadNullableMap", [["x", () => Spec.map(Number, { nullable: value } as never)]]);
      expect(compileError(target).message).toContain(`BadNullableMap.x: Spec.map options: "nullable" must be true`);
    },
  );

  test("Spec.map keeps nullable as given, with no other key; a spec copied with another nullable is refused too", () => {
    expect(Object.keys(Spec.map(Number, { nullable: false } as never))).toEqual(["of", "nullable"]);
    expect(Object.keys(Spec.map(Number))).toEqual(["of"]);
    expect(Spec.map(Number, { nullable: true }).nullable).toBe(true);
    /* A copy of a spec object with its own `nullable` (the type of MapSpec allows any value there). */
    const copied = { ...Spec.map(Number), nullable: "yes" };
    const target = schemaWith("CopiedNullableMap", [["x", () => copied]]);
    expect(compileError(target).message).toContain(`CopiedNullableMap.x: Spec.map options: "nullable" must be true`);
    const allowed = schemaWith("CopiedNullableMapOk", [["x", () => ({ ...Spec.map(Number), nullable: true })]]);
    expect(SchemaCompiler.compile(allowed).paths["x.$*"]?.nullable).toBe(true);
  });

  test("every documented option key is accepted", () => {
    const target = schemaWith("KnownOptions", [["name", () => String]], {
      collection: "known_options",
      autoIndex: false,
    });
    expect(() => SchemaCompiler.compile(target)).not.toThrow();
  });
});

describe("indexes", () => {
  test("unique on an optional field (E11000 on the second null)", () => {
    expect(compileError(schemaWith("UniqueOptional", [["email", () => String, { unique: true }]])).message).toMatch(
      /"unique" on a field that is not required — every document without it is indexed as null/,
    );
  });

  test("unique on a nullable field, even sparse", () => {
    expect(
      compileError(
        schemaWith("UniqueNullable", [["email", () => String, { unique: true, sparse: true, nullable: true }]]),
      ).message,
    ).toMatch(/"unique" on a nullable field — null values collide even in a sparse index/);
  });

  test("an index on a field the class does not have", () => {
    @Schema()
    class Indexed extends Entity {
      @Prop(() => String) name?: string;
    }
    MetadataBuilder.for(Indexed).addIndex({ nmae: 1 });
    expect(compileError(Indexed).message).toMatch(/"nmae" is not a field of the class/);
  });

  test("a partial filter or weights on a missing field", () => {
    const target = schemaWith("PartialCase", [["a", () => String]]);
    MetadataBuilder.for(target).addIndex({ a: 1 }, { partialFilterExpression: { $or: [{ b: { $exists: true } }] } });
    expect(compileError(target).message).toMatch(/partialFilterExpression "b" is not a field of the class/);
    const weights = schemaWith("WeightsCase", [["a", () => String]]);
    MetadataBuilder.for(weights).addIndex({ a: "text" }, { weights: { c: 2 } });
    expect(compileError(weights).message).toMatch(/weights."c" is not a field of the class/);
  });

  test("text: several fields merge into ONE index; an extra @Index text is an error", () => {
    @Index({ title: "text" })
    @Schema()
    class TwoTexts extends Entity {
      @Prop(() => String, { text: true }) title?: string;
      @Prop(() => String, { text: true }) body?: string;
    }
    expect(compileError(TwoTexts).message).toMatch(/at most one text index; "text: true" fields are merged into one/);
  });

  test("TTL needs a single Date field", () => {
    const target = schemaWith("TtlCase", [["name", () => String]]);
    MetadataBuilder.for(target).addIndex({ name: 1 }, { expireAfterSeconds: 10 });
    expect(compileError(target).message).toMatch(
      /expireAfterSeconds \(TTL\) needs a single-field index on a Date field/,
    );
  });

  test("the same keys with different definitions", () => {
    const target = schemaWith("DuplicateIndex", [["a", () => String, { index: true }]]);
    MetadataBuilder.for(target).addIndex({ a: 1 }, { unique: true });
    expect(compileError(target).message).toMatch(/two indexes named or keyed "a_1" with different definitions/);
  });

  test("index/unique on _id", () => {
    const target = { Ids: class {} }.Ids as ClassRef;
    MetadataBuilder.for(target).addField("_id", () => ObjectId, { unique: true, required: true });
    MetadataBuilder.for(target).setSchema({});
    /* A model's top-level _id only; a subdocument's _id is a plain field and may be indexed. */
    expect(() => SchemaCompiler.compileModel(target)).toThrow(/_id is always uniquely indexed by the server/);
  });

  test("sparse + partialFilterExpression", () => {
    const target = schemaWith("SparsePartial", [["a", () => String]]);
    MetadataBuilder.for(target).addIndex({ a: 1 }, { sparse: true, partialFilterExpression: { a: { $exists: true } } });
    expect(compileError(target).message).toMatch(/"sparse" and "partialFilterExpression" cannot be combined/);
  });
});

describe("time series", () => {
  test.each([
    [{ timeField: "nope" }, /timeField "nope" must be a non-nullable Date field/],
    [{ timeField: "label" }, /timeField "label" must be a non-nullable Date field/],
    [
      { timeField: "at", metaField: "at" },
      /metaField "at" must be a field of the class other than _id and the time field/,
    ],
    [{ timeField: "at", metaField: "_id" }, /metaField "_id"/],
  ] as const)("%j", (timeseries, message) => {
    const target = schemaWith(
      "Series",
      [
        ["at", () => Date, { required: true }],
        ["label", () => String],
      ],
      { timeseries },
    );
    expect(compileError(target).message).toMatch(message);
  });

  test("the time field must be required; capped and unique are refused", () => {
    expect(
      compileError(schemaWith("SeriesOptional", [["at", () => Date]], { timeseries: { timeField: "at" } })).message,
    ).toMatch(/must be required/);
    expect(
      compileError(
        schemaWith("SeriesCapped", [["at", () => Date, { required: true }]], {
          timeseries: { timeField: "at" },
          capped: { size: 1024 },
        }),
      ).message,
    ).toMatch(/cannot be capped/);
    expect(
      compileError(
        schemaWith("SeriesUnique", [["at", () => Date, { required: true, unique: true }]], {
          timeseries: { timeField: "at" },
        }),
      ).message,
    ).toMatch(/cannot have unique indexes/);
  });
});

describe("nested objects", () => {
  test("no _id, no hooks, no document options", () => {
    @Schema({ nested: true })
    class NestedWithHook {
      @Prop(() => String) a?: string;
      @Pre("document.save")
      touch(): void {}
    }
    expect(compileError(NestedWithHook).message).toMatch(/a nested object \(no _id, no own hooks\) — it has hooks/);
    const withId = { NestedId: class {} }.NestedId as ClassRef;
    MetadataBuilder.for(withId).addField("_id", () => ObjectId);
    MetadataBuilder.for(withId).setSchema({ nested: true, collection: "x" });
    expect(compileError(withId).message).toMatch(/it declares _id; option "collection" is for documents/);
  });
});

describe("discriminators", () => {
  test("duplicate values in a hierarchy", () => {
    @Schema()
    class Base extends Entity {}
    @Discriminator("same")
    class A extends Base {
      declare readonly __t: DiscriminatorValue<"same">;
    }
    @Discriminator("same")
    class B extends Base {
      declare readonly __t: DiscriminatorValue<"same">;
    }
    expect(compileError(Base).message).toMatch(
      /discriminator value "same" is already used by A in the hierarchy of Base/,
    );
    void A;
    void B;
  });

  test("a discriminator with its own @Schema", () => {
    @Schema()
    class Base2 extends Entity {}
    @Discriminator("x")
    @Schema()
    class Child extends Base2 {
      declare readonly __t: DiscriminatorValue<"x">;
    }
    expect(compileError(Child).message).toMatch(/a discriminator uses its root's schema options; remove @Schema/);
  });

  test("redeclaring a base field with another type (semantic merge)", () => {
    @Schema()
    class Base3 extends Entity {
      @Prop(() => String) value?: string;
    }
    @Discriminator("n")
    class Child3 extends Base3 {
      declare readonly __t: DiscriminatorValue<"n">;
    }
    MetadataBuilder.for(Child3).addField("value", () => Number);
    expect(compileError(Child3).message).toMatch(
      /Child3.value: redeclared with another type \(number in Child3, string in Base3\)/,
    );
  });

  test("the declared discriminator key must be a string field", () => {
    const base = { KeyBase: class extends Entity {} }.KeyBase as ClassRef;
    MetadataBuilder.for(base).addField("kind", () => Number);
    MetadataBuilder.for(base).setSchema({ discriminatorKey: "kind" });
    /* cast: a test double / bridge — a base class built at run time, extended as an entity */
    const child = { KeyChild: class extends (base as unknown as typeof Entity) {} }.KeyChild as ClassRef;
    MetadataBuilder.for(child).setDiscriminator("c");
    expect(compileError(base).message).toMatch(/the discriminator key "kind" must be a non-nullable string field/);
  });

  test("a discriminator registered after the base was compiled (sealed)", () => {
    @Schema()
    class Sealed extends Entity {}
    SchemaCompiler.compile(Sealed);
    expect(() => {
      @Discriminator("late")
      class Late extends Sealed {
        declare readonly __t: DiscriminatorValue<"late">;
      }
      void Late;
    }).toThrow(
      /its schema is already compiled; decorators, plugins and discriminators must be declared before the first use/,
    );
  });
});

describe("virtuals", () => {
  test("paths of a populate virtual are checked", () => {
    @Schema()
    class Author extends Entity {
      @Prop(() => String) name?: string;
    }
    @Schema()
    class Book extends Entity {
      @Prop(() => ObjectId) authorId?: ObjectId;
    }
    const bad = { BadVirtual: class extends Entity {} }.BadVirtual as ClassRef;
    MetadataBuilder.for(bad).addVirtual("books", { ref: () => Book, localField: "nope", foreignField: "authorId" });
    MetadataBuilder.for(bad).setSchema({});
    expect(compileError(bad).message).toMatch(/localField "nope" is not a field of the class/);
    const bad2 = { BadVirtual2: class extends Entity {} }.BadVirtual2 as ClassRef;
    MetadataBuilder.for(bad2).addVirtual("books", { ref: () => Book, localField: "_id", foreignField: "writer" });
    MetadataBuilder.for(bad2).setSchema({});
    expect(compileError(bad2).message).toMatch(/foreignField "writer" is not a field of Book/);
    void Author;
  });

  test("a @Virtual key that is also a field", () => {
    @Schema()
    class Target extends Entity {}
    @Schema()
    class Owner extends Entity {
      @Virtual({ ref: () => Target, localField: "_id", foreignField: "_id" }) items!: VirtualRef<Target>;
    }
    MetadataBuilder.for(Owner).addField("items", () => String);
    expect(compileError(Owner).message).toMatch(/@Virtual "items" is also a @Prop field/);
  });
});

test("every build error is a ConfigurationError (never a plain Error)", () => {
  expect(compileError(schemaWith("Final", [["x", () => Set]]))).toBeInstanceOf(ConfigurationError);
});

describe("policy fields", () => {
  test("tenant and softDelete fields must exist with the right type", () => {
    expect(compileError(schemaWith("TenantCase", [["name", () => String]], { tenant: true })).message).toMatch(
      /tenant field "tenantId" is not a field of the class/,
    );
    expect(
      compileError(schemaWith("SoftDeleteCase", [["deletedAt", () => Date]], { softDelete: true })).message,
    ).toMatch(/softDelete field "deletedAt" must be a nullable Date field/);
    expect(() =>
      SchemaCompiler.compile(
        schemaWith(
          "PolicyOk",
          [
            ["removedAt", () => Date, { nullable: true }],
            ["org", () => String],
          ],
          { softDelete: { field: "removedAt" }, tenant: { field: "org" } },
          ["org"],
        ),
      ),
    ).not.toThrow();
  });

  test("the tenant field is marked @Tenant(), and only it, only with the tenant policy", () => {
    expect(compileError(schemaWith("Unmarked", [["tenantId", () => String]], { tenant: true })).message).toBe(
      'Unmarked: the tenant field "tenantId" must be marked @Tenant() (declare it @Prop(...) @Tenant() tenantId!: TenantField<T>)',
    );
    expect(compileError(schemaWith("NoPolicy", [["tenantId", () => String]], {}, ["tenantId"])).message).toBe(
      'NoPolicy: @Tenant() on "tenantId", but the schema has no tenant policy — add tenant: true (or { field }) to @Schema',
    );
    expect(
      compileError(
        schemaWith(
          "TwoMarks",
          [
            ["tenantId", () => String],
            ["owner", () => String],
          ],
          { tenant: true },
          ["tenantId", "owner"],
        ),
      ).message,
    ).toBe('TwoMarks: @Tenant() marks "tenantId", "owner"; only the tenant field "tenantId" may be marked');
    expect(
      compileError(
        schemaWith(
          "OtherMark",
          [
            ["org", () => String],
            ["owner", () => String],
          ],
          { tenant: { field: "org" } },
          ["owner"],
        ),
      ).message,
    ).toMatch(/the tenant field "org" must be marked @Tenant\(\)/);
    const twice = schemaWith("Twice", [["tenantId", () => String]]);
    MetadataBuilder.for(twice).markTenantField("tenantId");
    expect(() => MetadataBuilder.for(twice).markTenantField("tenantId")).toThrow(
      new ConfigurationError('Twice: @Tenant is applied twice on "tenantId"'),
    );
  });

  test("the legacy @Tenant() decorator records the mark; a static member or a method is refused", () => {
    @Schema({ tenant: true })
    class Marked extends Entity {
      @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
    }
    expect(SchemaCompiler.compile(Marked).field("tenantId")).toBeDefined();
    const decorate = Tenant() as (target: object, key: string, descriptor?: unknown) => void;
    expect(() => decorate(Marked, "x")).toThrow(new ConfigurationError('Marked: @Tenant on static member "x"'));
    expect(() => decorate(Marked.prototype, "m", { value: () => 1 })).toThrow(
      new ConfigurationError('Marked: @Tenant on "m", which is a method or an accessor'),
    );
  });
});
