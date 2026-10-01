/*
 * A field of a base class may be declared as a union of its discriminator classes, without a new marker.
 * Negative cases state what must fail.
 */
import { Discriminator, type DiscriminatorValue, Prop, Schema } from "../../../src/index.ts";

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

@Schema()
class Unrelated {
  @Prop(() => Number)
  weight?: number;
}

@Schema()
export class Drawing {
  @Prop(() => [Shape])
  shapes!: (Circle | Square)[];

  @Prop(() => Shape)
  main?: Circle | Square;

  @Prop(() => [Shape])
  withBase!: (Shape | Circle)[];

  @Prop(() => [Shape])
  plain!: Shape[];
}

export class Wrong {
  // @ts-expect-error a union with a class outside the hierarchy of the spec class
  @Prop(() => [Shape])
  mixed!: (Circle | Unrelated)[];

  // @ts-expect-error a single subclass is still an exact-class mismatch
  @Prop(() => Shape)
  single!: Circle;
}
