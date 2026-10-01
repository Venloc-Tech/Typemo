/*
 * Schemas with `ext` of the test extension `testLabel`, compiled by
 * `test/unit/schema/extensions.test.ts` in a context of its own (a client registry), in the shared test process.
 */
import { Discriminator, type DiscriminatorValue, Entity, Prop, Schema, Spec } from "../../../src/index.ts";

/** A nested address whose `city` carries a label extension. */
@Schema({ nested: true })
export class ExtAddress {
  @Prop(() => String, { ext: { testLabel: { label: "City" } } }) city?: string;
}

/** An array-element subdocument whose `name` carries a label extension. */
@Schema()
export class ExtPet {
  @Prop(() => String, { ext: { testLabel: { label: "Pet name" } } }) name?: string;
}

/** The field option with a function typed by the field value (kept by reference, not copied). */
export const EXT_SAMPLE = { label: "Email", sample: (value: string): string => value.slice(0, 1) };

/** A person with extensions at the schema level and on every kind of field (scalar, array, Map, nested). */
@Schema({ ext: { testLabel: { group: "people" } } })
export class Person extends Entity {
  @Prop(() => String, { ext: { testLabel: EXT_SAMPLE }, dbName: "em" }) email?: string;
  @Prop(() => [String], { ext: { testLabel: { label: "Tags" } } }) tags?: string[];
  @Prop(() => ExtAddress) address?: ExtAddress;
  @Prop(() => [ExtPet]) pets?: ExtPet[];
  @Prop(() => Spec.map(Number), { ext: { testLabel: { label: "Scores" } } }) scores?: Map<string, number>;
  @Prop(() => Number) plain?: number;
}

/** A `Person` discriminator whose own field carries an extension. */
@Discriminator("admin")
export class Admin extends Person {
  declare readonly __t: DiscriminatorValue<"admin">;
  @Prop(() => String, { ext: { testLabel: { label: "Level" } } }) level?: string;
}

/** JS without types: a field extension under an unregistered key. */
@Schema()
export class Unregistered extends Entity {
  // @ts-expect-error — JS without types: "nope" is not a registered extension
  @Prop(() => String, { ext: { nope: 1 } })
  name?: string;
}

/** JS without types: a field extension with an invalid value. */
@Schema()
export class Invalid extends Entity {
  // @ts-expect-error — JS without types: label is not a string
  @Prop(() => String, { ext: { testLabel: { label: 1 } } })
  name?: string;
}

/** JS without types: a schema extension with an invalid value. */
// @ts-expect-error — JS without types: group is not a string
@Schema({ ext: { testLabel: { group: 5 } } })
export class InvalidSchema extends Entity {
  @Prop(() => String) name?: string;
}
