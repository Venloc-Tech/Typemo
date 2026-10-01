/*
 * On the real server: the discriminator key is immutable, like an `immutable` field — it says which class a
 * stored document is, so changing it would leave a document its class cannot read. Assignment on a document,
 * `$set`/`$unset`/`$rename` in updates, `findOneAndUpdate`, `bulkWrite` and update pipelines are refused with
 * `StrictModeError` (reason `immutable`); creating a document of a class still writes the key.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Model,
  Prop,
  Schema,
  StrictModeError,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** The base of the shapes. */
@Schema({ collection: "dk_shapes" })
class Shape extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

/** A circle. */
@Discriminator("circle")
class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;
  @Prop(() => Number) radius?: number;
}

/** A square. */
@Discriminator("square")
class Square extends Shape {
  declare readonly __t: DiscriminatorValue<"square">;
  @Prop(() => Number) side?: number;
}

/** A hierarchy whose key is a declared field. */
@Schema({ collection: "dk_events", discriminatorKey: "kind" })
class Event extends Entity {
  @Prop(() => String) kind!: string;
  @Prop(() => String) note?: string;
}

/** A click. */
@Discriminator("click")
class Click extends Event {
  declare readonly kind: DiscriminatorValue<"click">;
  @Prop(() => Number) x?: number;
}

const t = ModelLifecycle.useTypemo("dk");
let Shapes: Model<Shape>;
let Circles: Model<Circle>;

/**
 * The raw shapes collection.
 * @returns The driver collection.
 */
const raw = () => t.mongo.db.collection("dk_shapes");

/**
 * Awaits an operation that must be refused as a write of an immutable path.
 * @param run The operation.
 */
const immutable = async (run: () => PromiseLike<unknown> | unknown): Promise<void> => {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(StrictModeError);
  expect((error as StrictModeError).reason).toBe("immutable");
};

beforeEach(async () => {
  Shapes = t.connection.model(Shape);
  Circles = t.connection.model(Circle);
  t.connection.model(Square);
  await raw().deleteMany({});
  await t.mongo.db.collection("dk_events").deleteMany({});
});

describe("the discriminator key cannot be changed", () => {
  test("assignment on a stored document is refused by $save; nothing is written", async () => {
    const circle = await Circles.create({ name: "c", radius: 1 });
    (circle as { __t: string }).__t = "square";
    await immutable(() => circle.$save());
    expect((await raw().findOne({ _id: circle._id }))?.__t).toBe("circle");
    const again = await Circles.findById(circle._id).orFail();
    await immutable(() => again.$set("__t" as never, "wire" as never));
    expect((await raw().findOne({ _id: circle._id }))?.__t).toBe("circle");
  });

  test("$set, $unset and $rename in updateOne / updateMany, through the base and the discriminator model", async () => {
    const circle = await Circles.create({ name: "c", radius: 1 });
    await immutable(() => Shapes.updateOne({ _id: circle._id }, { $set: { __t: "square" } } as never).exec());
    await immutable(() => Circles.updateOne({ _id: circle._id }, { $set: { __t: "square" } } as never).exec());
    await immutable(() => Shapes.updateMany({ name: "c" }, { $unset: { __t: "" } } as never).exec());
    await immutable(() => Shapes.updateMany({ name: "c" }, { $rename: { __t: "name" } } as never).exec());
    expect((await raw().findOne({ _id: circle._id }))?.__t).toBe("circle");
  });

  test("findOneAndUpdate, bulkWrite and update pipelines", async () => {
    const circle = await Circles.create({ name: "c", radius: 1 });
    await immutable(() => Shapes.findOneAndUpdate({ _id: circle._id }, { $set: { __t: "square" } } as never).exec());
    await immutable(() =>
      Shapes.bulkWrite([{ updateOne: { filter: { _id: circle._id }, update: { $set: { __t: "square" } } } } as never]),
    );
    await immutable(() =>
      Shapes.updateOne({ _id: circle._id }, (p) => p.set(() => ({ __t: "square" }) as never)).exec(),
    );
    await immutable(() => Shapes.updateOne({ _id: circle._id }, (p) => p.unset("__t" as never)).exec());
    expect((await raw().findOne({ _id: circle._id }))?.__t).toBe("circle");
  });

  test("a key declared as a field is immutable too", async () => {
    const Clicks = t.connection.model(Click);
    const click = await Clicks.create({ note: "n", x: 1 });
    await immutable(() =>
      t.connection
        .model(Event)
        .updateOne({ _id: click._id }, { $set: { kind: "tap" } })
        .exec(),
    );
    expect((await t.mongo.db.collection("dk_events").findOne({ _id: click._id }))?.kind).toBe("click");
  });

  test("creating, updating other fields and replacing still work", async () => {
    const circle = await Circles.create({ name: "c", radius: 1 });
    circle.radius = 2;
    await circle.$save();
    await Circles.updateOne({ _id: circle._id }, { $set: { name: "d" } });
    await Circles.replaceOne({ _id: circle._id }, { name: "e", radius: 3 });
    expect(await raw().findOne({ _id: circle._id })).toMatchObject({ __t: "circle", name: "e", radius: 3 });
    const upserted = await Circles.updateOne({ name: "new" }, { $set: { radius: 9 } }, { upsert: true });
    expect((await raw().findOne({ _id: upserted.upsertedId as never }))?.__t).toBe("circle");
  });
});
