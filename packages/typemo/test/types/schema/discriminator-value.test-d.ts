/*
 * `declare readonly __t: DiscriminatorValue<"…">` is MANDATORY on a discriminator class — with the base's
 * `discriminatorKey` instead of `__t` when it has one. Without it `@Discriminator` is a type error (the messages
 * are checked in hover/schema/discriminator-m1-hover.test.ts). The benefit: every form of the document carries
 * the literal, and a union of discriminators narrows by the key.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type HydratedDoc,
  type Lean,
  Prop,
  Schema,
} from "../../../src/index.ts";

@Schema({ collection: "m1_shapes" })
class Shape extends Entity {
  @Prop(() => String) label?: string;
}

// Positive: the default key.
@Discriminator("circle")
class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true }) radius!: number;
}

@Discriminator("square")
class Square extends Shape {
  declare readonly __t: DiscriminatorValue<"square">;
  @Prop(() => Number, { required: true }) side!: number;
}

// Positive: a union of discriminators narrows by the declared key (lean and hydrated).
declare const leanShape: Lean<Circle> | Lean<Square>;
if (leanShape.__t === "circle") expectTypeOf(leanShape.radius).toEqualTypeOf<number>();
else expectTypeOf(leanShape.side).toEqualTypeOf<number>();
// The hydrated form too: TS 6 does not narrow a union by a BRANDED literal (`"square" & DefaultedMarker & …`), so the
// hydrated form carries string literals without markers — by the key or by the class, both narrow.
declare const hydrated: HydratedDoc<Circle> | HydratedDoc<Square>;
if (hydrated.__t === "square") expectTypeOf(hydrated.side).toEqualTypeOf<number>();
if (hydrated instanceof Square) expectTypeOf(hydrated.side).toEqualTypeOf<number>();
expectTypeOf<HydratedDoc<Circle>["__t"]>().toEqualTypeOf<"circle">();

// Positive: a custom discriminatorKey — the base declares it as a string, each class as its literal.
@Schema({ collection: "m1_events", discriminatorKey: "kind" })
class Event extends Entity {
  @Prop(() => String, { required: true }) kind!: string;
}
@Discriminator("click")
class Click extends Event {
  declare readonly kind: DiscriminatorValue<"click" | "double-click">;
  @Prop(() => String) element?: string;
}
// Positive: a nested discriminator — the intermediate declares its own and its sub-discriminators' values.
@Discriminator("double-click")
class DoubleClick extends Click {
  declare readonly kind: DiscriminatorValue<"double-click">;
  @Prop(() => Number) interval?: number;
}
expectTypeOf<Lean<DoubleClick>["kind"]>().toEqualTypeOf<"double-click">();

// Negative: no declaration at all.
// @ts-expect-error — `declare readonly __t: DiscriminatorValue<"triangle">` is missing
@Discriminator("triangle")
class Triangle extends Shape {
  @Prop(() => Number) corners?: number;
}

// Negative: a declaration with another literal.
// @ts-expect-error — __t is declared as "hexa", the value is "hexagon"
@Discriminator("hexagon")
class Hexagon extends Shape {
  declare readonly __t: DiscriminatorValue<"hexa">;
}

// Negative: a custom key declared with another literal (the key is found by its type, not its name).
// @ts-expect-error — no DiscriminatorValue<"view"> is declared (it says "seen")
@Discriminator("view")
class View extends Event {
  declare readonly kind: DiscriminatorValue<"seen">;
}

// Negative: a plain string field is not a declaration (it must be DiscriminatorValue: Defaulted + Immutable).
// @ts-expect-error — kind is a plain "tap" literal, not DiscriminatorValue<"tap">
@Discriminator("tap")
class Tap extends Event {
  declare readonly kind: "tap";
}

// Negative: the value omitted (the class-name default cannot be checked by the type).
// @ts-expect-error — @Discriminator() without a literal value
@Discriminator()
class Star extends Shape {
  declare readonly __t: DiscriminatorValue<"Star">;
}

void [Circle, Square, DoubleClick, Triangle, Hexagon, View, Tap, Star];
