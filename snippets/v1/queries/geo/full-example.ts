import { CastError, Entity, GeoJson, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema()
class GeoPoint {
  @Prop(() => String, { enum: ["Point"], required: true })
  type!: "Point";

  @Prop(() => [Number], { required: true })
  coordinates!: number[];
}

@Index({ location: "2dsphere" })
@Schema({ collection: "places" })
class Place extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => GeoPoint, { required: true })
  location!: GeoPoint;
}

// your code: the error at the application boundary
class __BadCoordinates__ extends Error {}

const EARTH_RADIUS_METERS = 6_378_100;

export const createPlaces = (client: TypemoClient) => {
  const Places = client.db().model(Place);

  // write: GeoJson.point checks the coordinates before reaching the database
  const add = async (name: string, longitude: number, latitude: number) => {
    try {
      return await Places.create({ name, location: GeoJson.point(longitude, latitude) });
    } catch (error) {
      if (error instanceof CastError) throw new __BadCoordinates__("coordinates are out of range");
      throw error;
    }
  };

  // nearest to the user, within the radius; ordered by distance
  const nearest = (longitude: number, latitude: number, meters: number, count: number) =>
    Places.find({ location: { $near: { $geometry: GeoJson.point(longitude, latitude), $maxDistance: meters } } })
      .limit(count)
      .plain();

  // count within a radius: $near is not allowed here, the circle is set in radians
  const countAround = (longitude: number, latitude: number, meters: number) =>
    Places.countDocuments({
      location: { $geoWithin: { $centerSphere: [[longitude, latitude], meters / EARTH_RADIUS_METERS] } },
    });

  return { add, nearest, countAround };
};
