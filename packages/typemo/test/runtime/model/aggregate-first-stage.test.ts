/*
 * `Model.aggregate` on a model with `Hidden` fields: the `$unset` of the hidden fields goes right AFTER a stage that
 * must be the first of a pipeline (`$search`, `$searchMeta`, `$vectorSearch`, `$geoNear`, `$collStats`,
 * `$indexStats`), never before it. Checked on the command sent: the search stages need Atlas, the local server refuses
 * them (`SearchNotEnabled`), but only after the pipeline was built and sent.
 */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  Entity,
  type Hidden,
  Index,
  type Model,
  Prop,
  Schema,
  ServerError,
  ServerErrorCodes,
  Spec,
  type Vector,
} from "../../../src/index.ts";
import { GeoPoint } from "../../fixtures/aggregate-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema({ collection: "afs_places" })
@Index({ location: "2dsphere" })
class AfsPlace extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;

  @Prop(() => Spec.vector({ dtype: "float32" }))
  embedding?: Vector;

  @Prop(() => GeoPoint)
  location?: GeoPoint;
}

const t = ModelLifecycle.useTypemo("aggregate_first_stage");
let Places: Model<AfsPlace>;

beforeAll(async () => {
  Places = t.connection.model(AfsPlace);
  await t.mongo.db.collection("afs_places").createIndex({ location: "2dsphere" });
});

beforeEach(async () => {
  await t.mongo.db
    .collection("afs_places")
    .insertOne({ title: "a", secret: "s", location: { type: "Point", coordinates: [0, 0] } });
  t.commands.clear();
});

/**
 * The stage names of the last `aggregate` command.
 * @returns The first key of each stage.
 */
const sentStages = (): string[] =>
  ((t.commands.byName("aggregate").at(-1)?.command.pipeline ?? []) as Record<string, unknown>[]).map(
    (stage) => Object.keys(stage)[0] ?? "",
  );

describe("the $unset of Hidden fields follows a first-only stage", () => {
  test("$search, $searchMeta and $vectorSearch stay first (the local server answers SearchNotEnabled)", async () => {
    const runs = [
      () => Places.aggregate((p) => p.search({ index: "default", text: { query: "a", path: "title" } })),
      () => Places.aggregate((p) => p.searchMeta({ index: "default", text: { query: "a", path: "title" } })),
      () =>
        Places.aggregate((p) =>
          p.vectorSearch({ index: "v", path: "embedding", queryVector: [0.1, 0.2], limit: 1, numCandidates: 5 }),
        ),
    ];
    const expected = ["$search", "$searchMeta", "$vectorSearch"];
    for (const [index, run] of runs.entries()) {
      const error = await run()
        .exec()
        .then(
          () => undefined,
          (failure: unknown) => failure,
        );
      expect(sentStages()).toEqual([expected[index] ?? "", "$unset"]);
      /* The local server has no Atlas Search: it refuses the stage with code 31082, after the pipeline was sent. */
      expect(error).toBeInstanceOf(ServerError);
      expect([(error as ServerError).code, (error as ServerError).codeName]).toEqual([
        ServerErrorCodes.SearchNotEnabled,
        "SearchNotEnabled",
      ]);
    }
  });

  test("$geoNear, $collStats and $indexStats run on the server with the $unset after them", async () => {
    const near = await Places.aggregate((p) =>
      p.geoNear({ near: { type: "Point", coordinates: [0, 0] }, distanceField: "distance", key: "location" }),
    );
    expect(sentStages()).toEqual(["$geoNear", "$unset"]);
    expect(near.map((row) => [row.title, "secret" in row])).toEqual([["a", false]]);
    await Places.aggregate((p) => p.collStats({ count: {} }));
    expect(sentStages()).toEqual(["$collStats", "$unset"]);
    expect((await Places.aggregate((p) => p.indexStats())).length).toBeGreaterThan(0);
    expect(sentStages()).toEqual(["$indexStats", "$unset"]);
  });

  test("any other first stage comes after the $unset", async () => {
    const rows = await Places.aggregate((p) => p.match({ title: "a" }));
    expect(sentStages()).toEqual(["$unset", "$match"]);
    expect(rows.map((row) => "secret" in row)).toEqual([false]);
  });
});
