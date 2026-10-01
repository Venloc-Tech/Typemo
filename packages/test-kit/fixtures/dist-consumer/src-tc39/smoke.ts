/* The runtime smoke of the TC39 decorators: compiled, run under Node against the built packages and a real MongoDB. */
import { TypemoClient } from "@venloc/typemo";
import { Code, Member, Team } from "./entities.js";

const uri = process.env.MONGO_URI;
if (uri === undefined) throw new Error("MONGO_URI is not set");
const client = await TypemoClient.connect(uri, { dbName: process.env.MONGO_DB ?? "dist_consumer_tc39" });
const out: Record<string, unknown> = {};
try {
  const Members = client.connection.model(Member);
  const Teams = client.connection.model(Team);
  await client.connection.init();
  const team = await Teams.create({ name: "core" });
  const created = await Members.create({
    name: "  Ann ",
    tags: ["a"],
    address: { city: " Paris " },
    team: team._id as never,
  });
  out.created = { name: created.name, city: created.address?.city, tags: [...created.tags] };
  out.afterSave = [...(await Members.findById(created._id).orFail().lean()).tags];
  out.populated = (await Members.findOne({ name: "Ann" }).populate("team").orFail().lean()).team?.name;
  let duplicate = "no error";
  try {
    await Members.create({ name: "Ann", tags: [] });
  } catch (error) {
    duplicate = (error as Error).constructor.name;
  }
  out.duplicate = duplicate;
  const Codes = client.connection.model(Code);
  await Codes.create({ _id: "A1", label: "first" });
  out.code = (await Codes.findById("A1").orFail().lean()).label;
} finally {
  await client.close();
}
console.log(`RESULT ${JSON.stringify(out)}`);
