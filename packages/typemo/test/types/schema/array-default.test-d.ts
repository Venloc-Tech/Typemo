/*
 * Arrays start as `[]` without `required` and `default`: the read type stays `T[]`, the create input makes an array
 * optional, and a `default` on an array needs no `Defaulted<T>` (it may still be declared). `required` + `nullable`:
 * the key is required in create, `null` is a value.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import { type CreateInput, type Defaulted, Entity, type Lean, type Model, Prop, Schema } from "../../../src/index.ts";

@Schema({ collection: "f117_posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [String], { default: () => [] }) labels!: string[];
  @Prop(() => [String], { default: () => ["a"] }) marks!: Defaulted<string[]>;
  @Prop(() => String, { required: true, nullable: true }) phone!: string | null;
}

declare const Posts: Model<Post>;

// Positive: the read type of an array stays `T[]` (never `undefined`).
expectTypeOf<Lean<Post>["tags"]>().toEqualTypeOf<string[]>();
expectTypeOf<Lean<Post>["labels"]>().toEqualTypeOf<string[]>();

// Positive: arrays are optional in create; `required` + `nullable` takes `null` and is required.
Posts.create({ title: "a", phone: null });
Posts.create({ title: "a", phone: "1", tags: ["x"], labels: [], marks: ["b"] });
expectTypeOf<CreateInput<Post>["phone"]>().toEqualTypeOf<string | null>();

// Negative: the required + nullable key cannot be left out.
// @ts-expect-error — `phone` is required (null is a value, absent is not)
Posts.create({ title: "a" });

// Negative: a default that does not fit the array.
@Schema({ collection: "f117_bad" })
class Bad extends Entity {
  // @ts-expect-error — the "default" value does not fit the field type
  @Prop(() => [String], { default: () => [1] }) tags!: string[];
}

// Negative: a non-array field with a default still needs Defaulted<T>.
@Schema({ collection: "f117_bad2" })
class Bad2 extends Entity {
  // @ts-expect-error — "default" is set, declare the field as Defaulted<T>
  @Prop(() => String, { default: "x" }) name!: string;
}

void [Bad, Bad2];
