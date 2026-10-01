/*
 * The populate queries of the shape tests, written ONCE: the runtime test runs them, the type probe
 * reads their result types from this module. One row per populate variant, lean
 * and hydrated. Data where every reference has its document: without `match` a single reference is typed
 * without `| null` (a missing document IS `null` at run time, the accepted gap).
 */
import type { PopulateModels } from "./populate-seed.ts";
import { P } from "./populate-seed.ts";

/**
 * The populate queries whose result types the shape tests compare with the runtime rows.
 *
 * @param m - the models of the populate graph
 * @returns one lazy query per variant, keyed by name
 */
export const shapePopulate = (m: PopulateModels) => ({
  /* references */
  refLean: () => m.People.findById(P.ann).populate("company").orFail().lean(),
  refHydrated: () => m.People.findById(P.ann).populate("company").orFail(),
  refHydratedPlain: async () => (await m.People.findById(P.ann).populate("company").orFail()).$toObject(),
  refHydratedJson: async () => (await m.People.findById(P.ann).populate("company").orFail()).$toJSON(),
  refMatched: () =>
    m.People.findById(P.ann)
      .populate({ path: "company", match: { size: { $gt: 100 } } })
      .orFail()
      .lean(),
  refSelectNoId: () =>
    m.People.findById(P.ann)
      .populate({ path: "company", select: { name: 1, _id: 0 } })
      .orFail()
      .lean(),
  refPlusHidden: () =>
    m.People.findById(P.ann)
      .populate({ path: "company", select: { "+secret": true } })
      .orFail()
      .lean(),
  refJustOneFalse: () => m.People.findById(P.ann).populate({ path: "company", justOne: false }).orFail().lean(),
  refNullable: () => m.People.findById(P.bob).populate("mentor").orFail().lean(),
  refNullableNull: () => m.People.findById(P.ann).populate("mentor").orFail().lean(),
  refArray: () => m.People.findById(P.ann).populate("friends").orFail().lean(),
  refArrayHydrated: () => m.People.findById(P.ann).populate("friends").orFail(),
  refArrayRetain: () => m.People.findById(P.ann).populate({ path: "friends", retainNullValues: true }).orFail().lean(),
  refArraySortLimit: () =>
    m.People.findById(P.ann)
      .populate({ path: "friends", select: { name: 1 }, options: { sort: { name: -1 }, limit: 1 } })
      .orFail()
      .lean(),
  refArrayJustOne: () => m.People.findById(P.ann).populate({ path: "friends", justOne: true }).orFail().lean(),
  transformSingle: () =>
    m.People.findById(P.ann)
      .populate({ path: "company", transform: (company, id) => ({ label: company?.name ?? "?", id }) })
      .orFail()
      .lean(),
  transformArray: () =>
    m.People.findById(P.ann)
      .populate({ path: "friends", transform: (friend) => friend?.name ?? null })
      .orFail()
      .lean(),
  transformHydrated: () =>
    m.People.findById(P.ann)
      .populate({ path: "friends", transform: (friend) => friend?.age ?? 0 })
      .orFail(),
  /* virtuals */
  virtualMany: () => m.People.findById(P.ann).populate("posts").orFail().lean(),
  virtualManyHydrated: () => m.People.findById(P.ann).populate("posts").orFail(),
  virtualJustOne: () => m.People.findById(P.ann).populate("topPost").orFail().lean(),
  virtualJustOneNone: () => m.People.findById(P.cid).populate("topPost").orFail().lean(),
  virtualCount: () => m.People.findById(P.ann).populate("postCount").orFail().lean(),
  virtualCountHydrated: () => m.People.findById(P.ann).populate("postCount").orFail(),
  virtualMatch: () =>
    m.People.findById(P.ann)
      .populate({ path: "publishedPosts", match: { views: { $gte: 1 } }, select: { title: 1, author: 1 } })
      .orFail()
      .lean(),
  virtualPerDocumentLimit: () =>
    m.People.find({ _id: { $in: [P.ann, P.bob] } })
      .populate({
        path: "posts",
        select: { title: 1, author: 1 },
        perDocumentLimit: 1,
        options: { sort: { views: -1 } },
      })
      .lean(),
  virtualUuid: () => m.Devices.findById(P.device).populate("readings").orFail().lean(),
  /* nested */
  nestedObject: () =>
    m.Posts.findById(P.p1)
      .populate({
        path: "comments",
        select: { body: 1, author: 1, post: 1 },
        populate: { path: "author", select: { name: 1 } },
      })
      .orFail()
      .lean(),
  nestedDotted: () => m.Comments.findById(P.c1).populate("post.author.company").orFail().lean(),
  nestedDottedHydrated: () => m.Comments.findById(P.c1).populate("post.author.company").orFail(),
  /* embedded */
  subdocumentArray: () => m.Orders.findById(P.o2).populate("lines.product").orFail().lean(),
  subdocumentArrayPlain: async () => (await m.Orders.findById(P.o2).populate("lines.product").orFail()).$toObject(),
  nestedObjectRef: () => m.Orders.findById(P.o2).populate("shipping.carrier").orFail().lean(),
  mapOfRefs: () => m.Orders.findById(P.o2).populate("extras.$*").orFail().lean(),
  mapOfRefsPlain: async () => (await m.Orders.findById(P.o2).populate("extras.$*").orFail()).$toObject(),
  mapOfSubdocuments: () => m.Orders.findById(P.o2).populate("notes.$*.author").orFail().lean(),
  /* polymorphic, discriminators */
  refPath: () => m.Activities.findById(P.a1).populate("target").orFail().lean(),
  refModel: () => m.Activities.findById(P.a2).populate("subject").orFail().lean(),
  /* selected: the stored discriminator key "__t" is not a declared field of Event, so no type has it */
  rootDiscriminator: () => m.Signups.findOne().select({ label: 1, user: 1 }).populate("user").orFail().lean(),
  embeddedDiscriminator: () =>
    m.Canvases.findById(P.canvas)
      .populate({ path: "shapes.owner", match: { name: "bob" } })
      .orFail()
      .lean(),
  /* other entry points */
  findOneAndUpdate: () =>
    m.People.findOneAndUpdate({ _id: P.bob }, { $set: { age: 41 } })
      .populate("mentor")
      .orFail()
      .lean(),
  matchFunction: () =>
    m.People.findById(P.ann)
      .populate({ path: "friends", match: (person) => ({ name: { $ne: person.name } }) })
      .orFail()
      .lean(),
  documentPopulate: async () => {
    const doc = await m.People.findById(P.ann).orFail();
    return (await doc.$populate({ path: "company", select: { name: 1 } })).$toObject();
  },
  documentDepopulate: async () => {
    const doc = await m.People.findById(P.ann).populate("friends").orFail();
    return doc.$depopulate("friends").$toObject();
  },
});

/**
 * The queries object returned by `shapePopulate`.
 *
 * @example
 * type Row = Awaited<ReturnType<ShapePopulate["refLean"]>>;
 */
export type ShapePopulate = ReturnType<typeof shapePopulate>;
