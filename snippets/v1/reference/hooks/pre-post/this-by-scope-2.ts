import { Entity, type HydratedDoc, Pre, Prop, Schema } from "@venloc/typemo";
// ---cut---
// @errors: 1241
@Schema()
export class Line extends Entity {
  @Prop(() => Number, { required: true })
  qty!: number;

  @Pre("document.save")
  check(this: HydratedDoc<Line>): void {}
}
