/*
 * `optimisticConcurrency` takes a list of the class's paths. `@Schema` has no `toJSON` / `toObject` options
 * (serialization options are given to each call).
 */
import { Entity, Prop, Schema, Spec, Versioned } from "../../../src/index.ts";

// ---- optimisticConcurrency: a list of the class's paths -------------------------------------------------
@Schema()
export class Item {
  @Prop(() => Number)
  qty?: number;
}

@Schema({ collection: "t_occ", optimisticConcurrency: ["balance", "items.qty", "settings.$*"] })
export class Account extends Versioned(Entity) {
  @Prop(() => Number)
  balance?: number;

  @Prop(() => [Item])
  items!: Item[];

  @Prop(() => Spec.map(String))
  settings?: Map<string, string>;
}

// @ts-expect-error — "balanse" is not a path of the class
@Schema({ collection: "t_occ_typo", optimisticConcurrency: ["balanse"] })
export class Typo extends Versioned(Entity) {
  @Prop(() => Number)
  balance?: number;
}

// @ts-expect-error — an empty list is not a list of paths (use true, or leave the option out)
@Schema({ collection: "t_occ_empty", optimisticConcurrency: [] })
export class Empty extends Versioned(Entity) {
  @Prop(() => Number)
  balance?: number;
}

// ---- no schema-level serialization defaults ----------------------------------------------------------
// @ts-expect-error — `toJSON` is not an option of @Schema (options are given per call)
@Schema({ collection: "t_no_to_json", toJSON: { virtuals: true } })
export class NoToJson extends Entity {
  @Prop(() => String)
  name?: string;
}

// @ts-expect-error — `toObject` is not an option of @Schema
@Schema({ collection: "t_no_to_object", toObject: { hidden: false } })
export class NoToObject extends Entity {
  @Prop(() => String)
  name?: string;
}
