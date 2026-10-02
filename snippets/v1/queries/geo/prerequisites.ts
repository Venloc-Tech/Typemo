import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Schema()
export class GeoPoint {
  @Prop(() => String, { enum: ["Point"], required: true })
  type!: "Point";

  @Prop(() => [Number], { required: true })
  coordinates!: number[];
}

@Index({ location: "2dsphere" })
@Schema({ collection: "places" })
export class Place extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => GeoPoint, { required: true })
  location!: GeoPoint;
}
