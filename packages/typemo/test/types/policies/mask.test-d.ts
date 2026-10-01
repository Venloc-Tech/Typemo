/*
 * A ready-made mask is typed by the value it accepts — it fits `sensitive` on a field of that type (nullable and
 * literal fields included) and is a compile error on a field of another type.
 */

import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { Decimal128 } from "mongodb";
import { Entity, Mask, type MaskOf, Prop, Schema, type SensitiveJson } from "../../../src/index.ts";

expectTypeOf(Mask.email()).toEqualTypeOf<MaskOf<string>>();
expectTypeOf(Mask.round(1)).toEqualTypeOf<MaskOf<number | bigint | Decimal128>>();
expectTypeOf(Mask.date("year")).toEqualTypeOf<MaskOf<Date>>();
expectTypeOf(Mask.presence()).toEqualTypeOf<MaskOf<unknown>>();
expectTypeOf(Mask.when((value: number) => value > 1, "show", Mask.bucket([1]))).toEqualTypeOf<MaskOf<number>>();
expectTypeOf(Mask.keep().mask).returns.toEqualTypeOf<SensitiveJson>();

@Schema()
export class MaskedUser extends Entity {
  @Prop(() => String, { sensitive: Mask.email() }) email?: string;
  @Prop(() => String, { sensitive: Mask.keep({ start: 1, end: 1 }), nullable: true }) nick?: string | null;
  @Prop(() => String, { sensitive: Mask.hmac({ key: "k" }), enum: ["a", "b"] }) code?: "a" | "b";
  @Prop(() => Number, { sensitive: Mask.bucket([18, 60]) }) age?: number;
  @Prop(() => Number, { sensitive: Mask.round(100) }) salary?: number;
  @Prop(() => Date, { sensitive: Mask.date("year") }) born?: Date;
  @Prop(() => [String], { sensitive: Mask.size() }) tags?: string[];
  @Prop(() => Number, { sensitive: Mask.type() }) any1?: number;
  @Prop(() => String, { sensitive: Mask.when((value: string) => value.length > 3, Mask.card(), "mask") }) card?: string;

  // @ts-expect-error a string mask on a number field
  @Prop(() => Number, { sensitive: Mask.email() }) wrong1?: number;
  // @ts-expect-error a number mask on a string field
  @Prop(() => String, { sensitive: Mask.bucket([1]) }) wrong2?: string;
  // @ts-expect-error a Date mask on a string field
  @Prop(() => String, { sensitive: Mask.date("month") }) wrong3?: string;
  // @ts-expect-error a string mask on a Date field
  @Prop(() => Date, { sensitive: Mask.keep() }) wrong4?: Date;
}

// @ts-expect-error "day" is not a unit of Mask.date
Mask.date("day");
// @ts-expect-error hmac needs its key (there is no global key)
Mask.hmac({ length: 8 });
// @ts-expect-error when's branches must fit the predicate's type
Mask.when((value: number) => value > 1, Mask.email(), "show");
// @ts-expect-error "hide" is not a choice of when
Mask.when((value: string) => value === "", "hide", "show");
