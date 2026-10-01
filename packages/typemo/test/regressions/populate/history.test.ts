/*
 * Regressions of research/mongoose/M11-history/history.yaml, area `populate`. Each test is named by
 * its Hnnn and follows the entry's `how_to_test` on the real server through Typemo's populate. Entries that
 * describe an API Typemo does not have are listed at the end with the reason (not silently dropped).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  Entity,
  Prop,
  QueryError,
  type Ref,
  Schema,
  StrictModeError,
  Types,
  Virtual,
  type VirtualRef,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { Company, Person, Signup } from "../../fixtures/populate/populate-entities.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

// ---- local fixtures of single entries -------------------------------------------------------------------

@Schema({ collection: "rh_colors" })
class Color extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema({ collection: "rh_shades" })
class Shade extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

/** H057/H092/H406: a polymorphic reference inside a Map of subdocuments, resolved per subdocument. */
@Schema()
class Swatch {
  @Prop(() => String, { required: true, enum: ["Color", "Shade"] })
  kind!: "Color" | "Shade";

  @Prop(() => Types.ObjectId, { refPath: "kind" })
  item?: Ref<Color | Shade>;

  @Prop(() => Types.ObjectId, { refModel: (owner: object) => ((owner as Swatch).kind === "Shade" ? Shade : Color) })
  picked?: Ref<Color | Shade>;
}

/** H215: a justOne virtual declared on a subdocument of an array. */
@Schema()
class Slot {
  @Prop(() => String, { required: true })
  code!: string;

  @Virtual({ ref: () => Color, localField: "code", foreignField: "name", justOne: true })
  color?: VirtualRef<Color, true>;
}

@Schema({ collection: "rh_palettes" })
class Palette extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => Color })
  main?: Ref<Color>;

  @Prop(() => [Slot])
  slots!: Slot[];

  @Prop(() => [Swatch])
  swatches!: Swatch[];
}

/** H178: a target whose `_id` has a getter: matching uses the stored value. */
@Schema({ collection: "rh_codes" })
class Code {
  @Prop(() => String, { required: true, get: (value: string) => value.toUpperCase() })
  _id!: string;

  @Prop(() => String, { required: true })
  label!: string;
}

@Schema({ collection: "rh_labels" })
class Label extends Entity {
  @Prop(() => String, { ref: () => Code, required: true })
  code!: Ref<Code, string>;
}

/** H462: a count virtual over an ARRAY local field. */
@Schema({ collection: "rh_boards" })
class Board extends Entity {
  @Prop(() => [String])
  names!: string[];

  @Virtual({ ref: () => Color, localField: "names", foreignField: "name", count: true })
  colorCount?: VirtualRef<Color, false, true>;
}

const t = ModelLifecycle.useTypemo("reg_populate");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
  for (const name of ["rh_colors", "rh_shades", "rh_palettes", "rh_codes", "rh_labels", "rh_boards"]) {
    await t.mongo.db.collection(name).deleteMany({});
  }
});

describe("history.yaml regressions: populate", () => {
  test("H011: a reference of a discriminator only, hydrated through the BASE model, is populated", async () => {
    const raw = await t.mongo.db.collection("pp_events").findOne({ __t: "signup" });
    if (raw === null) throw new Error("no signup");
    // `$is` narrows the document hydrated by the base model to the discriminator class
    const signup = m.Events.hydrate(raw);
    expect(signup).toBeInstanceOf(Signup);
    if (!signup.$is(Signup)) throw new Error("not a signup");
    const populated = await signup.$populate("user");
    expect(populated.user?.name).toBe("ann");
  });

  test("H031: more ids than one $in holds are looked up in batches, the result complete", async () => {
    const ids = Array.from({ length: 50_001 }, () => new ObjectId());
    await t.mongo.db.collection("pp_tags").insertMany(ids.map((_id, index) => ({ _id, label: `t${index}` })));
    await t.mongo.db.collection("pp_posts").updateOne({ _id: P.p3 }, { $set: { tags: ids } });
    t.commands.clear();
    const post = await m.Posts.findById(P.p3).populate("tags").orFail().lean();
    expect(post.tags.length).toBe(50_001);
    expect(t.commands.byName("find").length).toBe(3);
  }, 60_000);

  test("H057 / H092 / H406: refPath and refModel inside subdocuments resolve per subdocument", async () => {
    const Colors = t.connection.model(Color);
    const Shades = t.connection.model(Shade);
    const Palettes = t.connection.model(Palette);
    const red = await Colors.create({ name: "red" });
    const dark = await Shades.create({ name: "dark" });
    await Palettes.create({
      slots: [],
      swatches: [
        { kind: "Color", item: red._id, picked: red._id },
        { kind: "Shade", item: dark._id, picked: dark._id },
      ],
    });
    const palette = await Palettes.findOne().populate(["swatches.item", "swatches.picked"]).orFail();
    expect(palette.swatches.map((swatch) => swatch.item?.name)).toEqual(["red", "dark"]);
    expect(palette.swatches[1]?.picked).toBeInstanceOf(Shade);
  });

  test("H064: a match function sees ids, the nested populate runs on its result", async () => {
    let seenFriends: unknown;
    const ann = await m.People.findById(P.ann)
      .populate({
        path: "friends",
        match: (person) => {
          seenFriends = person.friends;
          return {};
        },
        populate: "company",
      })
      .orFail()
      .lean();
    expect(seenFriends).toEqual([P.bob, P.gone, P.cid]);
    expect(ann.friends[0]?.company?.name).toBe("globex");
  });

  test("H111: read options given after populate() apply to the populate queries", async () => {
    await m.People.findById(P.ann).populate("company").readPreference("secondaryPreferred").lean();
    const populate = t.commands.byName("find")[1];
    expect((populate?.command.$readPreference as { mode?: string } | undefined)?.mode).toBe("secondaryPreferred");
  });

  test("H116: a cursor populates after hydration: a populated document's subdocuments know their parent", async () => {
    for await (const order of m.Orders.find({ _id: P.o1 }).populate("lines.product").cursor()) {
      expect(order.lines[0]?.$parent()).toBe(order);
    }
  });

  test("H129: a virtual over an array of UUIDs finds every document", async () => {
    const device = await m.Devices.findById(P.device).populate("readings").orFail().lean();
    expect(device.readings?.length).toBe(2);
  });

  test("H132: deep populate below a Map of subdocuments", async () => {
    const order = await m.Orders.findById(P.o1)
      .populate({ path: "notes.$*.author", populate: "company" })
      .orFail()
      .lean();
    expect(order.notes?.first?.author?.company?.name).toBe("globex");
  });

  test("H134: several paths in a transaction: no session conflict (one query at a time)", async () => {
    await t.connection.transaction(async () => {
      const ann = await m.People.findById(P.ann)
        .populate(["company", "friends", "posts", "topPost", "tagsByTopic.$*"])
        .orFail();
      expect(ann.posts?.length).toBe(3);
    });
  });

  test("H145 (CVE-2025-23061): $where in a populate match, also nested, is refused", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "company", match: { $or: [{ $and: [{ $where: "true" }] }] } as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
  });

  test("H151: a cursor with populate and a large batchSize over many documents: no stack overflow", async () => {
    await t.mongo.db
      .collection("pp_comments")
      .insertMany(Array.from({ length: 3_000 }, (_, index) => ({ body: `b${index}`, post: P.p1, author: P.ann })));
    let count = 0;
    for await (const comment of m.Comments.find().batchSize(1_000).populate("author").lean().cursor()) {
      if (comment.author?.name === "ann" || comment.author?.name !== "") count++;
    }
    expect(count).toBe(3_003);
  }, 60_000);

  test("H156: one populate spec object used by two queries of two models: each correct", async () => {
    const spec = Object.freeze({ path: "author" as const });
    const post = await m.Posts.findById(P.p1).populate(spec).orFail().lean();
    const comment = await m.Comments.findById(P.c1).populate(spec).orFail().lean();
    expect(post.author?.name).toBe("ann");
    expect(comment.author?.name).toBe("bob");
  });

  test("H171: pushing an id into a populated array: refused (read-only view); $set replaces the ids", async () => {
    const ann = await m.People.findById(P.ann).populate("friends").orFail();
    /* cast: bypasses the type to test the runtime guard — a populated array is read-only (no push in the type) */
    expect(() => (ann.friends as unknown as ObjectId[]).push(P.dan)).toThrow(QueryError);
    ann.$set("friends", [P.dan]);
    expect(ann.$populated("friends")).toBeUndefined();
    /*
     * cast: the type cannot follow this in-place change — $set on a populated path depopulates it,
     * while the variable keeps the populated type
     */
    expect([...(ann.friends as unknown as ObjectId[])]).toEqual([P.dan]);
  });

  test("H178: matching uses the stored _id, never its getter", async () => {
    await t.connection.model(Code).create({ _id: "abc", label: "x" });
    await t.connection.model(Label).create({ code: "abc" });
    const label = await t.connection.model(Label).findOne().populate("code").orFail();
    expect(label.code?.label).toBe("x");
  });

  test("H181: a lean populate that finds nothing gives null, no error", async () => {
    const dan = await m.People.findById(P.dan).populate("company").orFail().lean();
    expect(dan.company).toBeNull();
  });

  test("H183 (Typemo): a document assigned to a Ref field stores its _id (the reference), not the document", async () => {
    const bob = await m.People.findById(P.bob).orFail();
    const acme = await m.Companies.findById(P.acme).orFail();
    bob.$set("company", acme as never);
    expect(bob.company).toBeInstanceOf(ObjectId);
    expect((bob.company as ObjectId).equals(P.acme)).toBe(true);
  });

  test("H213: select without _id: the populated documents have no _id", async () => {
    const ann = await m.People.findById(P.ann)
      .populate({ path: "friends", select: { name: 1, _id: 0 } })
      .orFail()
      .lean();
    expect(ann.friends).toEqual([{ name: "bob" }, { name: "cid" }]);
  });

  test("H215: a justOne virtual of the subdocuments of an array: each element gets ITS document", async () => {
    const Colors = t.connection.model(Color);
    const Palettes = t.connection.model(Palette);
    await Colors.insertMany([{ name: "red" }, { name: "blue" }, { name: "green" }]);
    await Palettes.create({
      slots: [{ code: "green" }, { code: "red" }, { code: "none" }, { code: "blue" }],
      swatches: [],
    });
    const palette = await Palettes.findOne().populate("slots.color").orFail().lean();
    expect(palette.slots.map((slot) => slot.color?.name ?? null)).toEqual(["green", "red", null, "blue"]);
  });

  test("H308: refPath whose name path the projection left out: an error that says what to select", async () => {
    await expect(m.Activities.find().select({ target: 1 }).populate("target").exec()).rejects.toThrow(/"kind"/);
  });

  test("H403: a path that does not exist is an error (and a type error)", async () => {
    await expect(
      m.People.find()
        .populate("typo" as never)
        .exec(),
    ).rejects.toThrow(QueryError);
  });

  test("H432: match on _id is combined with the ids (both conditions)", async () => {
    const ann = await m.People.findById(P.ann)
      .populate({ path: "friends", match: { _id: { $ne: P.cid } } })
      .orFail()
      .lean();
    expect(ann.friends.map((friend) => friend.name)).toEqual(["bob"]);
  });

  test("H460: a cursor with batchSize populates per batch, not per document", async () => {
    let seen = 0;
    for await (const _person of m.People.find().batchSize(2).populate("company").cursor()) seen++;
    expect(seen).toBe(4);
    const populateQueries = t.commands.byName("find").length - 1;
    expect(populateQueries).toBeLessThanOrEqual(2);
  });

  test("H462: a count virtual over an array local field counts each document once", async () => {
    await t.connection.model(Color).insertMany([{ name: "red" }, { name: "blue" }, { name: "red" }]);
    const Boards = t.connection.model(Board);
    await Boards.create({ names: ["red", "blue", "none"] });
    const board = await Boards.findOne().populate("colorCount").orFail().lean();
    expect(board.colorCount).toBe(3);
  });

  test("H473: many refPath values naming the same model: one query for that model", async () => {
    await t.mongo.db
      .collection("pp_activities")
      .insertMany(Array.from({ length: 500 }, () => ({ kind: "Post", target: P.p2, subject: P.p2 })));
    t.commands.clear();
    const activities = await m.Activities.find({ kind: "Post" }).populate("target").lean();
    expect(activities.length).toBe(501);
    expect(t.commands.byName("find").length).toBe(2);
  });

  test("H476: a virtual without documents is [] (not undefined)", async () => {
    const cid = await m.People.findById(P.cid).populate("posts").orFail().lean();
    expect(cid.posts).toEqual([]);
  });
});

// Not applicable (Typemo has no such API; see test/ported/INDEX.md, from-mongoose-to-typemo/DIVERGENCES.md):
// - H206: a setter on a virtual-populated path — populate virtuals have no setters (`@Virtual` fields hold nothing).
// - H457: memory of a cursor over 1M documents with populate — not run (size); the cursor keeps no populate state
//   between batches (a new population per batch), which was the leak.
void Company;
void Person;
