/*
 * Ported from mongoose test/model.discriminator.test.js onto Typemo's class discriminators
 * (inheritance + @Discriminator). The document/model parts (create, save, find) live elsewhere;
 * here the logic is checked on the compiled schemas.
 */
import { describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  type Defaulted,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  MetadataBuilder,
  Plugin,
  Pre,
  Prop,
  Schema,
  SchemaCompiler,
  type SchemaPlugin,
  SchemaWalker,
  StandardSchema,
} from "../../../src/internal.ts";

@Schema({ nested: true })
class PersonNameParts {
  @Prop(() => String) first?: string;
  @Prop(() => String) last?: string;
}

let employeeSaves = 0;

@Index({ name: 1 })
@Schema({ collection: "model-discriminator" })
class Person extends Entity {
  @Prop(() => PersonNameParts) name?: PersonNameParts;
  @Prop(() => String, { validate: (value) => /[A-Z]/.test(value) || "Invalid name" }) gender?: string;
  getFullName(): string {
    return `${this.name?.first} ${this.name?.last}`;
  }
}

@Index({ department: 1 })
@Discriminator("Employee")
class Employee extends Person {
  declare readonly __t: DiscriminatorValue<"Employee">;
  @Prop(() => String, { validate: (value) => /[a-zA-Z]/.test(value) || "Invalid name" }) department?: string;
  getDepartment(): string | undefined {
    return this.department;
  }
  @Pre("document.save")
  countSave(): void {
    employeeSaves++;
  }
}

const person = () => SchemaCompiler.compile(Person);
const employee = () => SchemaCompiler.compile(Employee);

describe("model.discriminator (ported)", () => {
  // ported from mongoose test/model.discriminator.test.js:182 "sets schema root discriminator mapping"
  test("sets schema root discriminator mapping", () => {
    expect(person().discriminator).toBeUndefined();
    expect(person().discriminatorKey).toBe("__t");
  });

  // ported from mongoose test/model.discriminator.test.js:187 "sets schema discriminator type mapping"
  test("sets schema discriminator type mapping", () => {
    expect(employee().discriminator).toEqual({ root: Person, key: "__t", value: "Employee" });
  });

  // ported from mongoose test/model.discriminator.test.js:192 "adds discriminatorKey to schema with default as name"
  test("adds discriminatorKey to schema with default as name", () => {
    const key = employee().field("__t");
    expect(key?.kind === "scalar" && key.type).toBe("string");
    expect(SchemaWalker.castDocument(employee(), {}).__t).toBe("Employee");
  });

  // ported from mongoose test/model.discriminator.test.js:198 "adds discriminator to Model.discriminators object"
  test("adds discriminator to Model.discriminators object", () => {
    expect([...person().discriminators.keys()]).toEqual(["Employee"]);
    expect(person().discriminators.get("Employee")).toBe(employee());
  });

  // ported from mongoose test/model.discriminator.test.js:216 "throws error when attempting to nest discriminators"
  test("throws error when attempting to nest discriminators — divergence: nesting is allowed (the value registers to the root)", () => {
    @Schema()
    class Root extends Entity {}
    @Discriminator("mid")
    class Mid extends Root {
      /* an intermediate declares its own and its sub-discriminators' values */
      declare readonly __t: DiscriminatorValue<"mid" | "leaf">;
    }
    @Discriminator("leaf")
    class Leaf extends Mid {
      declare readonly __t: DiscriminatorValue<"leaf">;
    }
    expect([...SchemaCompiler.compile(Root).discriminators.keys()]).toEqual(["mid", "leaf"]);
    expect(SchemaCompiler.compile(Leaf).discriminator?.root).toBe(Root);
  });

  // ported from mongoose test/model.discriminator.test.js:225 "throws error when discriminator has mapped discriminator key in schema"
  test("throws error when discriminator has mapped discriminator key in schema", () => {
    @Schema()
    class Base extends Entity {}
    @Discriminator("foo")
    class Foo extends Base {
      declare readonly __t: DiscriminatorValue<"foo">;
    }
    MetadataBuilder.for(Foo).addField("__t", () => Number);
    // The key is the base's service field; redeclaring it with another type is a type conflict.
    expect(() => SchemaCompiler.compile(Base)).toThrow(ConfigurationError);
  });

  // ported from mongoose test/model.discriminator.test.js:244 "throws error when discriminator with taken name is added"
  test("throws error when discriminator with taken name is added", () => {
    @Schema()
    class Base extends Entity {}
    @Discriminator("Token")
    class A extends Base {
      declare readonly __t: DiscriminatorValue<"Token">;
    }
    @Discriminator("Token")
    class B extends Base {
      declare readonly __t: DiscriminatorValue<"Token">;
    }
    expect(() => SchemaCompiler.compile(Base)).toThrow(/discriminator value "Token" is already used by A/);
    void A;
    void B;
  });

  // ported from mongoose test/model.discriminator.test.js:320 "inherits field mappings"
  test("inherits field mappings", () => {
    expect(employee().field("name")?.kind).toBe("nested");
    expect(employee().field("gender")?.kind).toBe("scalar");
    expect(person().field("department")).toBeUndefined();
  });

  // ported from mongoose test/model.discriminator.test.js:326 "inherits validators"
  test("inherits validators", async () => {
    const result = await StandardSchema.of(employee())["~standard"].validate({ gender: "x", department: "1" });
    expect(result.issues?.map((issue) => [issue.path?.join("."), issue.message])).toEqual([
      ["gender", "Invalid name"],
      ["department", "Invalid name"],
    ]);
  });

  // ported from mongoose test/model.discriminator.test.js:332 "does not inherit and override fields that exist"
  test("does not inherit and override fields that exist", () => {
    // A fresh base: Person is already compiled by the tests above, and a discriminator registered
    // after its base was compiled is an error in Typemo (the base's schema is sealed).
    @Schema()
    class Human extends Entity {
      @Prop(() => String) gender?: string;
    }
    @Discriminator("model-discriminator-female")
    class Female extends Human {
      declare readonly __t: DiscriminatorValue<"model-discriminator-female">;
      @Prop(() => String, { default: "F" }) override gender!: Defaulted<string>;
    }
    const gender = SchemaCompiler.compile(Female).field("gender");
    expect(gender?.owner).toBe(Female);
    expect(gender?.kind === "scalar" && gender.type).toBe("string");
    expect(gender?.defaultValue?.()).toBe("F");
    expect(SchemaCompiler.compile(Human).field("gender")?.defaultValue).toBeUndefined();
  });

  // ported from mongoose test/model.discriminator.test.js:343 "allows discriminator schema to override required true with required false and allowNull false"
  test("allows discriminator schema to override required true with required false", async () => {
    @Schema()
    class Base extends Entity {
      @Prop(() => String, { required: true }) name!: string;
    }
    @Discriminator("Child")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"Child">;
      @Prop(() => String) override name!: string;
    }
    expect(SchemaCompiler.compile(Base).field("name")?.required).toBe(true);
    expect(SchemaCompiler.compile(Child).field("name")?.required).toBe(false);
    expect((await StandardSchema.of(SchemaCompiler.compile(Child))["~standard"].validate({})).issues).toBeUndefined();
    // allowNull: false is Typemo's default (null only with nullable: true).
    expect(
      (await StandardSchema.of(SchemaCompiler.compile(Child))["~standard"].validate({ name: null })).issues?.[0]?.path,
    ).toEqual(["name"]);
  });

  // ported from mongoose test/model.discriminator.test.js:381 "inherits methods"
  test("inherits methods", () => {
    const worker = new Employee();
    expect(worker.getFullName).toBe(Person.prototype.getFullName);
    expect(typeof worker.getDepartment).toBe("function");
    expect((new Person() as Partial<Employee>).getDepartment).toBeUndefined();
  });

  // ported from mongoose test/model.discriminator.test.js:400 "does not inherit indexes"
  test("does not inherit indexes — divergence: the discriminator's own indexes are scoped on the root collection", () => {
    expect(person().indexes.map((index) => [index.keys, index.options])).toEqual([
      [{ name: 1 }, {}],
      [{ department: 1 }, { partialFilterExpression: { __t: "Employee" } }],
    ]);
  });

  // ported from mongoose test/model.discriminator.test.js:408 "gets options overridden by root options except toJSON and toObject"
  test("gets options overridden by root options except toJSON and toObject", () => {
    expect(employee().options).toEqual(person().options);
    expect(employee().collection).toBe("model-discriminator");
  });

  // ported from mongoose test/model.discriminator.test.js:420 "does not allow setting discriminator key (gh-2041)"
  test("does not allow setting discriminator key (gh-2041)", () => {
    expect(() => SchemaWalker.castDocument(employee(), { __t: "fake" })).toThrow(
      /"fake" is not a discriminator value of Person/,
    );
  });

  // ported from mongoose test/model.discriminator.test.js:434 "deduplicates hooks (gh-2945)"
  test("deduplicates hooks (gh-2945)", () => {
    let called = 0;
    @Schema({ discriminatorKey: "type" })
    class ActivityBase extends Entity {
      @Prop(() => String) type!: string;
      @Prop(() => String) name?: string;
      @Pre("document.validate")
      middleware(): void {
        ++called;
      }
    }
    @Discriminator("D")
    class Comment extends ActivityBase {
      declare readonly type: DiscriminatorValue<"D">;
      @Prop(() => String, { required: true }) text!: string;
    }
    for (const hook of SchemaCompiler.compile(Comment).hooks["document.validate"].pre) hook.call(undefined);
    expect(called).toBe(1);
  });

  // ported from mongoose test/model.discriminator.test.js:716 "incorrect discriminator key throws readable error with create (gh-6434)"
  test("incorrect discriminator key throws readable error with create (gh-6434)", () => {
    expect(() => SchemaWalker.castDocument(person(), { __t: "Foo" })).toThrow(
      /"Foo" is not a discriminator value of Person \(known: Employee\)/,
    );
  });

  // ported from mongoose test/model.discriminator.test.js:1041 "embedded in document arrays (gh-2723)"
  test("embedded in document arrays (gh-2723)", () => {
    @Schema({ discriminatorKey: "kind" })
    class Event {
      @Prop(() => String) kind!: string;
      @Prop(() => String) message?: string;
    }
    @Discriminator("Clicked")
    class Clicked extends Event {
      declare readonly kind: DiscriminatorValue<"Clicked">;
      @Prop(() => String) element?: string;
    }
    @Discriminator("Purchased")
    class Purchased extends Event {
      declare readonly kind: DiscriminatorValue<"Purchased">;
      @Prop(() => String) product?: string;
    }
    @Schema()
    class Batch extends Entity {
      @Prop(() => [Event]) events?: Event[];
    }
    const cast = SchemaWalker.castDocument(SchemaCompiler.compile(Batch), {
      events: [
        { kind: "Clicked", element: "#hero", message: "hello" },
        { kind: "Purchased", product: "action-figure-1", message: "world" },
      ],
    });
    expect(cast.events).toEqual([
      { kind: "Clicked", element: "#hero", message: "hello" },
      { kind: "Purchased", product: "action-figure-1", message: "world" },
    ]);
    void Clicked;
    void Purchased;
  });

  // ported from mongoose test/model.discriminator.test.js:1095 "embedded with single nested subdocs (gh-5244)"
  test("embedded with single nested subdocs (gh-5244)", () => {
    @Schema({ discriminatorKey: "type" })
    class Shape {
      @Prop(() => String) type!: string;
    }
    @Discriminator("Circle")
    class Circle extends Shape {
      declare readonly type: DiscriminatorValue<"Circle">;
      @Prop(() => Number) radius?: number;
    }
    @Discriminator("Square")
    class Square extends Shape {
      declare readonly type: DiscriminatorValue<"Square">;
      @Prop(() => Number) side?: number;
    }
    @Schema()
    class Holder extends Entity {
      @Prop(() => Shape) shape?: Shape;
    }
    const holder = SchemaCompiler.compile(Holder);
    expect(SchemaWalker.castDocument(holder, { shape: { type: "Circle", radius: 5 } })).toEqual({
      shape: { type: "Circle", radius: 5 },
    });
    expect(() => SchemaWalker.castDocument(holder, { shape: { type: "Circle", side: 5 } })).toThrow(
      /path "shape.side" for \d+ \(number\): not a field of Circle/,
    );
    void Circle;
    void Square;
  });

  // ported from mongoose test/model.discriminator.test.js:1212 "Embedded discriminators in nested doc arrays (gh-6202)"
  test("Embedded discriminators in nested doc arrays (gh-6202)", () => {
    @Schema({ discriminatorKey: "kind" })
    class Item {
      @Prop(() => String) kind!: string;
    }
    @Discriminator("A")
    class ItemA extends Item {
      declare readonly kind: DiscriminatorValue<"A">;
      @Prop(() => String) a?: string;
    }
    @Schema()
    class Section {
      @Prop(() => [Item]) items?: Item[];
    }
    @Schema()
    class Page extends Entity {
      @Prop(() => [Section]) sections?: Section[];
    }
    const page = SchemaCompiler.compile(Page);
    expect(SchemaWalker.castDocument(page, { sections: [{ items: [{ kind: "A", a: "x" }] }] })).toEqual({
      sections: [{ items: [{ kind: "A", a: "x" }] }],
    });
    expect(page.resolve("sections.0.items.1.kind")?.path).toBe("sections.$.items.$.kind");
    void ItemA;
  });

  // ported from mongoose test/model.discriminator.test.js:1566 "merges schemas instead of overwriting (gh-7884)"
  test("merges schemas instead of overwriting (gh-7884)", () => {
    @Schema({ nested: true })
    class Details {
      @Prop(() => String) a?: string;
    }
    @Schema()
    class Base extends Entity {
      @Prop(() => Details) details?: Details;
    }
    @Discriminator("Child")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"Child">;
      @Prop(() => String) b?: string;
    }
    expect(Object.keys(SchemaCompiler.compile(Child).paths)).toEqual(["_id", "details", "details.a", "b", "__t"]);
  });

  // ported from mongoose test/model.discriminator.test.js:2456 "does not duplicate _indexes when base and discriminator schemas share nested schema (gh-15966)"
  test("does not duplicate _indexes when base and discriminator schemas share nested schema (gh-15966)", () => {
    @Schema()
    class Shared {
      @Prop(() => String, { index: true }) code?: string;
    }
    @Schema()
    class Base extends Entity {
      @Prop(() => Shared) a?: Shared;
    }
    @Discriminator("Child")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"Child">;
      @Prop(() => Shared) b?: Shared;
    }
    expect(SchemaCompiler.compile(Base).indexes.map((index) => index.keys)).toEqual([{ "a.code": 1 }, { "b.code": 1 }]);
    void Child;
  });

  // ported from mongoose test/model.discriminator.test.js:2503 "preserves discriminator-specific indexes (gh-15966)"
  test("preserves discriminator-specific indexes (gh-15966)", () => {
    expect(employee().indexes.map((index) => index.keys)).toEqual([{ name: 1 }, { department: 1 }]);
  });

  // ported from mongoose test/model.discriminator.test.js:1394 "should copy plugins"
  test("should copy plugins", () => {
    const applied: string[] = [];
    const plugin: SchemaPlugin = { name: "copy", apply: (builder) => void applied.push(builder.target.name) };
    @Plugin(plugin)
    @Schema()
    class Base extends Entity {}
    @Discriminator("Child")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"Child">;
    }
    SchemaCompiler.compile(Base);
    expect(applied).toEqual(["Base", "Child"]);
    void Child;
  });

  test("the fixture Employee pre-save hook is registered once", () => {
    expect(employee().hooks["document.save"].pre.length).toBe(1);
    void employeeSaves;
  });
});
