import { describe, expect, test } from "bun:test";
import {
  CastError,
  ConfigurationError,
  Discriminator,
  type Discriminators,
  type DiscriminatorValue,
  Entity,
  Pre,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
  StandardSchema,
} from "../../../src/internal.ts";
import { Circle, Person, Shape, Square } from "../../fixtures/schema-entities.ts";

/*
 * Discriminators through class inheritance + @Discriminator(value), resolved BY VALUE, embedded ones included,
 * schemas merged semantically.
 */

describe("hierarchy", () => {
  test("the root maps values to schemas; a discriminator shares the root's map, collection and key", () => {
    const root = SchemaCompiler.compile(Shape);
    expect([...root.discriminators.keys()]).toEqual(["circle", "square"]);
    expect(root.discriminatorFor("circle")?.target).toBe(Circle);
    expect(root.discriminatorFor("Circle")).toBeUndefined(); // by value, never by class name
    expect(root.discriminatorFor(1)).toBeUndefined();
    const circle = SchemaCompiler.compile(Circle);
    expect(circle.discriminator).toEqual({ root: Shape, key: "kind", value: "circle" });
    expect(circle.discriminators).toBe(root.discriminators);
    expect(circle.root).toBe(root);
    expect(circle.collection).toBe(root.collection);
    expect(circle.discriminatorKey).toBe("kind");
  });

  test("a discriminator has the base paths plus its own (semantic merge)", () => {
    expect(SchemaCompiler.compile(Circle).fields.map((field) => field.key)).toEqual(["kind", "label", "radius"]);
    expect(SchemaCompiler.compile(Square).field("radius")).toBeUndefined();
  });

  test("the default value is the class name; the default key __t is a service field", () => {
    @Schema()
    class Vehicle extends Entity {
      @Prop(() => Number) wheels?: number;
    }
    // @ts-expect-error — the type cannot check the class-name default; the runtime default is still the class name
    @Discriminator()
    class Car extends Vehicle {}
    const car = SchemaCompiler.compile(Car);
    expect(car.discriminator?.value).toBe("Car");
    expect(car.field("__t")?.service).toBe("discriminatorKey");
    expect(SchemaCompiler.compile(Vehicle).field("__t")?.service).toBe("discriminatorKey");
    expect(SchemaWalker.castDocument(car, { wheels: 4 })).toEqual({ wheels: 4, __t: "Car" });
  });

  test("three levels: every discriminator registers to the root, values are unique in the tree", () => {
    @Schema()
    class Event extends Entity {}
    @Discriminator("click")
    class Click extends Event {
      declare readonly __t: DiscriminatorValue<
        "click" | "double-click"
      >; /* the intermediate of a nested discriminator */
      @Prop(() => String) element?: string;
    }
    @Discriminator("double-click")
    class DoubleClick extends Click {
      declare readonly __t: DiscriminatorValue<"double-click">;
      @Prop(() => Number) interval?: number;
    }
    const root = SchemaCompiler.compile(Event);
    expect([...root.discriminators.keys()]).toEqual(["click", "double-click"]);
    /* The service key __t is added after the declared fields. */
    expect(SchemaCompiler.compile(DoubleClick).fields.map((field) => field.key)).toEqual([
      "_id",
      "element",
      "interval",
      "__t",
    ]);
    expect(SchemaCompiler.compile(DoubleClick).discriminator?.root).toBe(Event);
  });

  test("a repeated value fails when the second class is compiled as a model, before the root is compiled", () => {
    @Schema()
    class Payment extends Entity {}
    @Discriminator("card")
    class Card extends Payment {
      declare readonly __t: DiscriminatorValue<"card">;
    }
    @Discriminator("card")
    class Duplicate extends Payment {
      declare readonly __t: DiscriminatorValue<"card">;
    }
    /* model(Duplicate) compiles Duplicate as a model; the root is not compiled first. */
    expect(() => SchemaCompiler.compileModel(Duplicate)).toThrow(
      new ConfigurationError(
        'Duplicate: discriminator value "card" is already used by Card in the hierarchy of Payment',
      ),
    );
    /* The hierarchy is invalid as a whole: the first class of the pair fails too, naming the later one. */
    expect(() => SchemaCompiler.compileModel(Card)).toThrow(/discriminator value "card" is already used by Card/);
  });

  test("a repeated value below an intermediate discriminator is found from any class of the tree", () => {
    @Schema()
    class Event extends Entity {}
    @Discriminator("click")
    class Click extends Event {
      declare readonly __t: DiscriminatorValue<"click">;
    }
    @Discriminator("click")
    class Again extends Click {
      declare readonly __t: DiscriminatorValue<"click">;
    }
    expect(() => SchemaCompiler.compileModel(Again)).toThrow(
      /Again: discriminator value "click" is already used by Click/,
    );
    expect(() => SchemaCompiler.compile(Event)).toThrow(ConfigurationError);
  });

  test("a discriminator uses the root's schema options", () => {
    @Schema({ collection: "logs", discriminatorKey: "type" })
    class Log extends Entity {
      @Prop(() => String) type!: string;
    }
    @Discriminator("error")
    class ErrorLog extends Log {
      declare readonly type: DiscriminatorValue<"error">;
    }
    expect(SchemaCompiler.compile(ErrorLog).options.collection).toBe("logs");
    expect(SchemaCompiler.compile(ErrorLog).discriminatorKey).toBe("type");
  });

  test("base hooks run once for a discriminator document, base first", () => {
    const calls: string[] = [];
    @Schema()
    class Base extends Entity {
      @Pre("document.save")
      baseHook(): void {
        calls.push("base");
      }
    }
    @Discriminator("child")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"child">;
      @Pre("document.save")
      childHook(): void {
        calls.push("child");
      }
    }
    const hooks = SchemaCompiler.compile(Child).hooks["document.save"].pre;
    for (const hook of hooks) hook.call(undefined);
    expect(calls).toEqual(["base", "child"]);
    expect(SchemaCompiler.compile(Base).hooks["document.save"].pre.length).toBe(1);
  });
});

describe("casting by value", () => {
  test("a root document without a key is the root; with a key it is that discriminator", () => {
    const root = SchemaCompiler.compile(Shape);
    expect(SchemaWalker.castDocument(root, { label: "x" })).toEqual({ label: "x" });
    expect(SchemaWalker.castDocument(root, { kind: "circle", radius: 1 })).toEqual({ kind: "circle", radius: 1 });
    expect(() => SchemaWalker.castDocument(root, { kind: "circle", side: 1 })).toThrow(
      /path "side" for \d+ \(number\): not a field of Circle/,
    );
  });

  test("an unknown value is an error, not the base", () => {
    const root = SchemaCompiler.compile(Shape);
    try {
      SchemaWalker.castDocument(root, { kind: "triangle" });
      throw new Error("no error");
    } catch (error) {
      expect(error).toBeInstanceOf(CastError);
      expect((error as CastError).reason).toBe("discriminator");
      expect((error as CastError).message).toContain(
        '"triangle" is not a discriminator value of Shape (known: circle, square)',
      );
    }
  });

  test("a discriminator schema refuses a value of a sibling", () => {
    expect(() => SchemaWalker.castDocument(SchemaCompiler.compile(Circle), { kind: "square", side: 1 })).toThrow(
      /selects Square, which is not a Circle/,
    );
  });

  test("embedded discriminators in arrays (validation per variant)", async () => {
    const validate = StandardSchema.of(SchemaCompiler.compile(Person))["~standard"].validate;
    const result = await validate({
      name: { first: "A" },
      shapes: [{ kind: "circle", radius: -1 }, { kind: "square" }],
    });
    expect(result.issues?.map((issue) => [issue.path, issue.message])).toEqual([
      [["shapes", 0, "radius"], "must be at least 0"],
      [["shapes", 1, "side"], "the field is required"],
    ]);
  });

  test("recursive schemas with discriminators", () => {
    @Schema({ discriminatorKey: "kind" })
    class TreeNode {
      @Prop(() => String) kind!: string;
      @Prop(() => [TreeNode]) children?: TreeNode[];
    }
    @Discriminator("leaf")
    class Leaf extends TreeNode {
      declare readonly kind: DiscriminatorValue<"leaf">;
      @Prop(() => String) value?: string;
    }
    @Discriminator("branch")
    class Branch extends TreeNode {
      declare readonly kind: DiscriminatorValue<"branch">;
      @Prop(() => TreeNode) main?: TreeNode;
    }
    const root = SchemaCompiler.compile(TreeNode);
    const cast = SchemaWalker.castDocument(root, {
      kind: "branch",
      main: { kind: "leaf", value: "x" },
      children: [{ kind: "branch", children: [{ kind: "leaf", value: "y" }] }],
    });
    expect(cast).toEqual({
      kind: "branch",
      main: { kind: "leaf", value: "x" },
      children: [{ kind: "branch", children: [{ kind: "leaf", value: "y" }] }],
    });
    expect(root.resolve("children.0.children.1.kind")?.kind).toBe("scalar");
    void Leaf;
    void Branch;
  });
});

describe("the discriminators list of a base (@Schema({ discriminators }))", () => {
  test("a custom discriminatorKey declared only in the type: the core adds it as a service field", () => {
    @Schema({ discriminatorKey: "kind", discriminators: () => [Click] })
    class Event extends Entity {
      declare readonly kind?: Discriminators<Click>;
      @Prop(() => String) source?: string;
    }
    @Discriminator("click")
    class Click extends Event {
      declare readonly kind: DiscriminatorValue<"click">;
      @Prop(() => String) element?: string;
    }
    const root = SchemaCompiler.compile(Event);
    expect(root.field("kind")?.service).toBe("discriminatorKey");
    expect(SchemaCompiler.compile(Click).discriminator).toEqual({ root: Event, key: "kind", value: "click" });
    expect(SchemaWalker.castDocument(root, { kind: "click", element: "b" })).toMatchObject({
      kind: "click",
      element: "b",
    });
  });

  test("a list naming every class of the hierarchy compiles, from the base and from a child", () => {
    @Schema({ discriminators: () => [Card, Transfer, Instant] })
    class Payment extends Entity {
      declare readonly __t?: Discriminators<Card | Transfer | Instant>;
    }
    @Discriminator("card")
    class Card extends Payment {
      declare readonly __t: DiscriminatorValue<"card">;
    }
    @Discriminator("transfer")
    class Transfer extends Payment {
      declare readonly __t: DiscriminatorValue<"transfer" | "instant">;
    }
    @Discriminator("instant")
    class Instant extends Transfer {
      declare readonly __t: DiscriminatorValue<"instant">;
    }
    expect([...SchemaCompiler.compile(Payment).discriminators.keys()]).toEqual(["card", "transfer", "instant"]);
    expect(SchemaCompiler.compileModel(Instant).discriminator?.root).toBe(Payment);
  });

  test("a registered class missing from the list is a ConfigurationError, from any class of the tree", () => {
    @Schema({ discriminators: () => [Card] })
    class Payment extends Entity {
      declare readonly __t?: Discriminators<Card>;
    }
    @Discriminator("card")
    class Card extends Payment {
      declare readonly __t: DiscriminatorValue<"card">;
    }
    @Discriminator("transfer")
    class Transfer extends Payment {
      declare readonly __t: DiscriminatorValue<"transfer">;
    }
    const message =
      'Payment: the "discriminators" list does not match the hierarchy — registered but not listed: Transfer';
    expect(() => SchemaCompiler.compile(Payment)).toThrow(new ConfigurationError(message));
    expect(() => SchemaCompiler.compileModel(Transfer)).toThrow(new ConfigurationError(message));
  });

  test("a listed class that is not a discriminator of the base is a ConfigurationError", () => {
    @Schema()
    class Other extends Entity {}
    @Schema({ discriminators: () => [Card, Other] })
    class Payment extends Entity {
      declare readonly __t?: Discriminators<Card | Other>;
    }
    @Discriminator("card")
    class Card extends Payment {
      declare readonly __t: DiscriminatorValue<"card">;
    }
    expect(() => SchemaCompiler.compile(Payment)).toThrow(
      new ConfigurationError(
        'Payment: the "discriminators" list does not match the hierarchy — listed but not a @Discriminator class below Payment: Other',
      ),
    );
  });

  test("a class listed twice, and an option that is not a thunk of classes, are ConfigurationErrors", () => {
    @Schema({ discriminators: () => [Card, Card] })
    class Payment extends Entity {
      declare readonly __t?: Discriminators<Card>;
    }
    @Discriminator("card")
    class Card extends Payment {
      declare readonly __t: DiscriminatorValue<"card">;
    }
    expect(() => SchemaCompiler.compile(Payment)).toThrow(/a class is listed twice/);
    /* An untyped caller (a plugin, JavaScript) passes the list itself. */
    // @ts-expect-error — the option is a list, not a thunk: its classes cannot match the declaration
    @Schema({ discriminators: ["Solo"] as never })
    class Loose extends Entity {
      declare readonly __t?: Discriminators<Solo>;
    }
    @Discriminator("solo")
    class Solo extends Loose {
      declare readonly __t: DiscriminatorValue<"solo">;
    }
    const shape = new ConfigurationError(
      'Loose: "discriminators" must be a thunk returning a list of classes: () => [Child, …]',
    );
    expect(() => SchemaCompiler.compile(Loose)).toThrow(shape);
    expect(() => SchemaCompiler.compileModel(Solo)).toThrow(shape);
  });
});
