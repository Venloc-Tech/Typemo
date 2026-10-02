import { Entity, EntityWithId, fn, Prop, Schema, Timestamped, TypemoClient, Types, type Ref } from "@venloc/typemo";
import { UUID } from "mongodb";

// lookup table: the caller sets the country code
@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true }) name!: string;
}

// session: the UUID is generated, timestamps are added as usual
@Schema({ collection: "sessions" })
class Session extends Timestamped(EntityWithId(() => Types.UUID, { default: () => new UUID() })) {
  @Prop(() => String, { required: true }) user!: string;
}

// a city references a country by string and a session by UUID
@Schema({ collection: "cities" })
class City extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { ref: () => Country, required: true }) country!: Ref<Country, string>;
  @Prop(() => [Types.UUID], { ref: () => Session }) visitors!: Ref<Session, UUID>[];
}

// summary: the result of grouping by country
@Schema({ collection: "country_totals" })
class CountryTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) cities!: number;
}

// your code: the error at the application boundary
class __NotFound__ extends Error {}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Countries = client.db().model(Country);
const Sessions = client.db().model(Session);
const Cities = client.db().model(City);
const Totals = client.db().model(CountryTotal);

export const addCountry = async (code: string, name: string) => Countries.create({ _id: code, name });

export const openSession = async (user: string) => Sessions.create({ user });

export const addCity = async (name: string, country: string, visitors: UUID[]) =>
  Cities.create({ name, country, visitors });

export const cityWithCountry = async (name: string) => {
  const city = await Cities.findOne({ name }).populate("country").orFail();
  if (city.country === null) throw new __NotFound__(`no country for ${name}`);
  return { city: city.name, country: city.country.name };
};

export const rebuildTotals = async () => {
  await Cities.aggregate((p) => p.group((f) => ({ _id: f.country, cities: fn.sum(1) })).out(CountryTotal));
  return Totals.find().sort({ _id: 1 }).lean();
};
