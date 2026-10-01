/*
 * `ext` of `@Prop`/`@Schema` takes the keys integrations add by declaration merging (here the test extension of
 * test-kit); an unknown key or a wrong value is a compile error.
 */
import { expectTypeOf } from "expect-type";
import "../../../../test-kit/fixtures/extensions/test-label-extension.ts";
import type { TestLabelPropOptions } from "../../../../test-kit/fixtures/extensions/test-label-extension.ts";
import {
  Entity,
  type ExtensionName,
  Prop,
  type PropExtensions,
  Schema,
  type SchemaExtensions,
  type TypemoExtension,
} from "../../../src/index.ts";

expectTypeOf<PropExtensions<number>["testLabel"]>().toEqualTypeOf<TestLabelPropOptions<number> | undefined>();
expectTypeOf<SchemaExtensions["testLabel"]>().toEqualTypeOf<{ readonly group: string } | undefined>();
expectTypeOf<ExtensionName>().toEqualTypeOf<"testLabel">();

// The extension option sees the field type: `sample` of a Date field takes a Date.
@Schema({ ext: { testLabel: { group: "g" } } })
export class Labeled extends Entity {
  @Prop(() => String, { ext: { testLabel: { label: "Name", sample: (value) => value.toUpperCase() } } })
  name?: string;

  @Prop(() => Date, { ext: { testLabel: { label: "At", sample: (value) => value.toISOString() } } })
  at?: Date;
}

@Schema()
export class WrongKey extends Entity {
  // @ts-expect-error — "nope" is not a registered extension (PropExtensions)
  @Prop(() => String, { ext: { nope: 1 } })
  name?: string;
}

@Schema()
export class WrongValue extends Entity {
  // @ts-expect-error — testLabel.label must be a string
  @Prop(() => String, { ext: { testLabel: { label: 1 } } })
  name?: string;
}

@Schema()
export class WrongSample extends Entity {
  // @ts-expect-error — sample of a number field takes a number, not a string
  @Prop(() => Number, { ext: { testLabel: { label: "n", sample: (value: string) => value } } })
  n?: number;
}

// @ts-expect-error — "nope" is not a registered extension (SchemaExtensions)
@Schema({ ext: { nope: { group: "g" } } })
export class WrongSchemaKey extends Entity {}

// @ts-expect-error — testLabel.group must be a string
@Schema({ ext: { testLabel: { group: 1 } } })
export class WrongSchemaValue extends Entity {}

// An extension is typed by its name; an unknown name is an error.
export const ok: TypemoExtension<"testLabel"> = { name: "testLabel", validateProp: () => undefined };
// @ts-expect-error — "other" is not a key of PropExtensions/SchemaExtensions
export const bad: TypemoExtension<"other"> = { name: "other" };
