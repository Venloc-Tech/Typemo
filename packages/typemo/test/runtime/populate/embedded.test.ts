/*
 * Populate on the real server: references INSIDE embedded data — arrays of subdocuments (`lines.product`), a
 * nested object (`shipping.carrier`), a Map of references (`extras.$*`), a Map of subdocuments
 * (`notes.$*.author`) — polymorphic references (`refPath`, `refModel`), root discriminators (a reference of
 * one discriminator only) and embedded discriminators. Change tracking of the documents that hold
 * populated values: nothing is modified, the stored ids are what a save writes.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { QueryError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { Circle, Comment, Post, Signup } from "../../fixtures/populate/populate-entities.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_embedded");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

/**
 * The names of the commands recorded so far.
 * @returns The command names in order.
 */
const commands = () => t.commands.all().map((command) => command.commandName);
/**
 * Reads the seeded order straight from the collection.
 * @returns The stored raw document.
 */
const storedOrder = () => t.mongo.db.collection("pp_orders").findOne({ _id: P.o1 });

describe("arrays of subdocuments and nested objects", () => {
  test("lines.product: each element's reference; a missing product is null; one query", async () => {
    const order = await m.Orders.findById(P.o1).populate("lines.product").orFail().lean();
    /* without `match` the type of a single reference has no `| null`; the missing product IS null */
    const names: (string | null)[] = order.lines.map((line) => (line.product as { name: string } | null)?.name ?? null);
    expect(names).toEqual(["pen", null, "ink"]);
    expect(commands()).toEqual(["find", "find"]);
  });

  test("hydrated: the subdocuments hold the documents; tracking is unchanged; a change inside a line is saved as ids", async () => {
    const order = await m.Orders.findById(P.o1).populate("lines.product").orFail();
    expect(order.lines[0]?.product?.name).toBe("pen");
    expect(order.$isModified()).toBe(false);
    expect(order.$populated("lines.product")).toEqual([P.pen, P.goneProduct, P.ink]);
    order.lines[2]?.$set("qty", 5);
    t.commands.clear();
    await order.$save();
    const update = t.commands.byName("update")[0]?.updates[0]?.update;
    expect(update).toEqual({ $set: { "lines.2.qty": 5 } });
    /* a whole rewrite of the array writes the stored ids of every line (nothing lost) */
    order.lines.reverse();
    await order.$save();
    const stored = await storedOrder();
    expect(stored?.lines.map((line: { product: unknown }) => line.product)).toEqual([P.ink, P.goneProduct, P.pen]);
  });

  test("shipping.carrier (a nested object)", async () => {
    const order = await m.Orders.findById(P.o1)
      .populate({ path: "shipping.carrier", select: { name: 1 } })
      .orFail();
    expect(order.shipping?.carrier?.name).toBe("acme");
    expect(order.$toObject().shipping).toEqual({ city: "Paris", carrier: { _id: P.acme, name: "acme" } });
  });

  test("dbName aliases on both sides (Post.author is stored as 'a', Product.name as 'n')", async () => {
    const posts = await m.Posts.find({ author: P.bob })
      .populate({ path: "author", select: { name: 1 } })
      .lean();
    expect(posts[0]?.author?.name).toBe("bob");
    const order = await m.Orders.findById(P.o1)
      .populate({ path: "lines.product", select: { name: 1 } })
      .orFail()
      .lean();
    expect(order.lines[0]?.product).toEqual({ _id: P.pen, name: "pen" });
    const sent = t.commands.byName("find").at(-1)?.command.projection as Record<string, unknown>;
    expect(sent.n).toBe(1);
  });
});

describe("Maps", () => {
  test("a Map of references (extras.$*): per key, null when missing; hydrated: a read-only Map (delete too)", async () => {
    const lean = await m.Orders.findById(P.o1).populate("extras.$*").orFail().lean();
    expect(lean.extras as unknown).toEqual({ gift: { _id: P.ink, name: "ink", price: 2 }, lost: null });
    const order = await m.Orders.findById(P.o1).populate("extras.$*").orFail();
    expect(order.extras?.get("gift")?.name).toBe("ink");
    /* cast: bypasses the type to test the runtime guard — a populated Map is read-only (the type has no set) */
    expect(() => (order.extras as unknown as Map<string, unknown>).set("x", null)).toThrow(QueryError);
    /* cast: bypasses the type to test the runtime guard — deleting the null entry of a populated Map */
    expect(() => (order.extras as unknown as Map<string, unknown>).delete("lost")).toThrow(QueryError);
    expect(order.$populated("extras.$*")).toEqual(
      new Map([
        ["gift", P.ink],
        ["lost", P.goneProduct],
      ]),
    );
    expect(order.$isModified()).toBe(false);
    const depopulated = order.$depopulate("extras");
    expect(depopulated.extras?.get("gift")).toEqual(P.ink); /* typed Ref<Product> again */
  });

  test("a Map of subdocuments (notes.$*.author)", async () => {
    const order = await m.Orders.findById(P.o1).populate("notes.$*.author").orFail().lean();
    expect(order.notes?.first?.author?.name).toBe("bob");
    expect(order.notes?.second).toEqual({ text: "anonymous" });
  });
});

describe("polymorphic references", () => {
  test("refPath: the model named by the owner's field; one query per model", async () => {
    const activities = await m.Activities.find().sort({ kind: -1 }).populate("target").lean();
    expect(activities.map((activity) => activity.kind)).toEqual(["Post", "Comment"]);
    expect((activities[0]?.target as { title?: string } | undefined)?.title).toBe("one");
    expect((activities[1]?.target as { body?: string } | undefined)?.body).toBe("c1");
    expect(commands()).toEqual(["find", "find", "find"]);
  });

  test("refPath: the name path not selected is an error (Mongoose did not know the model)", async () => {
    await expect(m.Activities.find().select({ target: 1 }).populate("target").exec()).rejects.toThrow(/select it/);
  });

  test("refModel: a function of the owner and the id picks the model", async () => {
    const activities = await m.Activities.find().sort({ kind: -1 }).populate("subject").orFail();
    expect(activities[0]?.subject).toBeInstanceOf(Post);
    expect(activities[1]?.subject).toBeInstanceOf(Comment);
  });

  test("nothing below a polymorphic reference can be populated", async () => {
    await expect(
      m.Activities.find()
        .populate("target.author" as never)
        .exec(),
    ).rejects.toThrow(/polymorphic/);
  });
});

describe("discriminators", () => {
  test("root: a reference of one discriminator, through the base model: each document by its own schema", async () => {
    const events = await m.Signups.find().populate("user").lean();
    expect(events[0]?.user?.name).toBe("ann");
    const all = await m.Events.find().sort({ label: 1 }).orFail();
    /* `$is` narrows a document of the base model to the discriminator class */
    const signup = all.find((event) => event.$is(Signup));
    if (signup === undefined || !signup.$is(Signup)) throw new Error("no signup");
    const populated = await signup.$populate("user");
    expect(populated.user?.name).toBe("ann");
  });

  test("embedded: a reference of one member of the union; the other members are left as they are", async () => {
    const canvas = await m.Canvases.findById(P.canvas).populate("shapes.owner").orFail();
    const [first, second, third] = canvas.shapes;
    expect(first).toBeInstanceOf(Circle);
    /* the union narrows by the declared key; the circle's owner is the populated person */
    expect(first?.kind === "circle" && first.owner?.name).toBe("bob");
    expect(second && "owner" in second).toBe(false);
    expect(third?.kind === "circle" && third.owner).toBeNull();
    expect(canvas.$isModified()).toBe(false);
  });
});
