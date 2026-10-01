import { describe, expect, test } from "bun:test";
import {
  Discriminator,
  type DiscriminatorValue,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
} from "../../../src/internal.ts";

/*
 * A field declared as a union of subclasses of its spec class (`@Prop(() => [Shape]) shapes!: (Circle |
 * Square)[]`). The type side is tested in test/types/schema/embedded-discriminators.test-d.ts; here the run time:
 * a value that is an INSTANCE of a registered discriminator class is resolved by its class (the key is filled),
 * an instance of an unregistered subclass is refused (it would silently lose its own fields), plain objects keep
 * the resolution by the discriminator key.
 */

@Schema({ discriminatorKey: "kind" })
class Shape {
  @Prop(() => String, { required: true })
  kind!: string;
}

@Discriminator("circle")
class Circle extends Shape {
  declare readonly kind: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true })
  radius!: number;
}

@Discriminator("square")
class Square extends Shape {
  declare readonly kind: DiscriminatorValue<"square">;
  @Prop(() => Number, { required: true })
  side!: number;
}

class Triangle extends Shape {
  base!: number;
}

@Schema()
class Drawing {
  @Prop(() => [Shape])
  shapes!: (Circle | Square)[];
}

const circle = (radius: number): Circle => Object.assign(new Circle(), { radius });

describe("embedded discriminators resolved by class", () => {
  const schema = SchemaCompiler.compile(Drawing);

  test("an instance of a registered discriminator selects its schema and gets its key", () => {
    const square = Object.assign(new Square(), { side: 2 });
    expect(SchemaWalker.castDocument(schema, { shapes: [circle(1), square] })).toEqual({
      shapes: [
        { kind: "circle", radius: 1 },
        { kind: "square", side: 2 },
      ],
    });
  });

  test("plain objects still resolve by the key", () => {
    expect(SchemaWalker.castDocument(schema, { shapes: [{ kind: "square", side: 3 }] })).toEqual({
      shapes: [{ kind: "square", side: 3 }],
    });
  });

  test("an instance of an unregistered subclass is refused", () => {
    const triangle = Object.assign(new Triangle(), { base: 1 });
    expect(() => SchemaWalker.castDocument(schema, { shapes: [triangle] })).toThrow(
      /Triangle is not a registered discriminator of Shape/,
    );
  });

  test("an instance that carries its key keeps it", () => {
    const withKey = Object.assign(new Circle(), { kind: "circle", radius: 5 });
    expect(SchemaWalker.castDocument(schema, { shapes: [withKey] })).toEqual({
      shapes: [{ kind: "circle", radius: 5 }],
    });
  });
});
