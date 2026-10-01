/* Typed usage of the TC39 decorators' entities through the built declarations (compile only). */
import type { Model, TypemoClient } from "@venloc/typemo";
import { Member, Team } from "./entities.js";

/**
 * Exercises the API.
 *
 * @param client - a client that is never connected
 * @returns values whose types are checked
 */
export const usage = async (client: TypemoClient) => {
  const Members: Model<Member> = client.connection.model(Member);
  const Teams = client.connection.model(Team);
  const created = await Members.create({ name: "a", tags: [], address: { city: "Paris" } });
  const city: string | undefined = created.address?.city;
  const row = await Members.findOne({ name: "a" }).populate("team").orFail().lean();
  const team = await Teams.find().lean();
  return { city, row, team };
};
