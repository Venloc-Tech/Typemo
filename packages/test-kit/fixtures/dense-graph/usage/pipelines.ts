/* Twelve aggregations over the dense graph: the per-chain cost of the pipeline builder. */
import { fn, Pipeline, type RowOf, Vars, withWindow } from "@venloc/typemo";
import { Comment, MentionNotification, Notification, Post, User } from "../entities.ts";

const p1 = Pipeline.from(User)
  .match((f) => fn.and(fn.gte(f.age, 18), fn.eq(f.active, true)))
  .project((f) => ({ name: 1, city: f.profile.address.city, friends: fn.size(f.followers) }));

const p2 = Pipeline.from(Post)
  .unwind("$revisions")
  .group((f) => ({
    _id: { post: f._id, editor: f.revisions.editor },
    added: fn.sum(f.revisions.diff.added),
    files: fn.push(f.revisions.diff.files),
  }));

const p3 = Pipeline.from(Comment).lookup({
  from: User,
  as: "author",
  let: (f) => ({ uid: f.author }),
  pipeline: (p, v) => p.match((u) => fn.eq(u._id, v.uid)).project({ name: 1, email: 1 }),
});

const p4 = Pipeline.from(Post).setWindowFields({
  partitionBy: (f) => f.author,
  sortBy: { publishedAt: 1 },
  output: (f) => ({
    rank: fn.rank(),
    running: withWindow(fn.sum(f.meta.views), { documents: ["unbounded", "current"] }),
  }),
});

const p5 = Pipeline.from(User).facet({
  byRole: (b) => b.group((f) => ({ _id: f.role, n: fn.count() })),
  top: (b) => b.sort({ visits: -1 }).limit(5).project({ name: 1 }),
});

const p6 = Pipeline.from(Notification).unionWith(MentionNotification).match({ read: false });

const p7 = Pipeline.from(Post).addFields((f) => ({
  words: fn.map({ input: f.blocks, in: (b) => fn.ifNull(b.kind, "text") }),
  firstTag: fn.arrayElemAt(f.tags, 0),
  age: fn.dateDiff({ startDate: f.publishedAt, endDate: fn.now(), unit: "day" }),
}));

const p8 = Pipeline.from(Comment).graphLookup({
  from: Comment,
  startWith: (f) => f.parent,
  connectFromField: "parent",
  connectToField: "_id",
  as: "thread",
  depthField: "depth",
});

const p9 = Pipeline.from(User)
  .bucket({
    groupBy: (f) => f.age,
    boundaries: [0, 18, 65],
    default: "other",
    output: (f) => ({ n: fn.count(), names: fn.push(f.name) }),
  })
  .sort({ n: -1 });

const p10 = Pipeline.from(Post)
  .redact((f) => fn.cond(fn.eq(f.status, "archived"), Vars.PRUNE, Vars.DESCEND))
  .replaceWith((f) => fn.mergeObjects(f.meta, { title: f.title }));

const p11 = Pipeline.from(Comment)
  .group((f) => ({ _id: f.post, best: fn.top({ output: f.body, sortBy: [[f.score, -1]] }), avg: fn.avg(f.score) }))
  .lookup({ from: Post, localField: "_id", foreignField: "_id", as: "post" });

const p12 = Pipeline.from(User)
  .sortByCount((f) => f.role)
  .out(User as never);

/* Every row is read, so the row types are computed (not only referenced). */
export const read = (
  r1: RowOf<typeof p1>,
  r2: RowOf<typeof p2>,
  r3: RowOf<typeof p3>,
  r4: RowOf<typeof p4>,
  r5: RowOf<typeof p5>,
  r6: RowOf<typeof p6>,
  r7: RowOf<typeof p7>,
  r8: RowOf<typeof p8>,
  r9: RowOf<typeof p9>,
  r10: RowOf<typeof p10>,
  r11: RowOf<typeof p11>,
): unknown[] => [
  r1.city,
  r2._id.editor,
  r3.author[0]?.email,
  r4.running,
  r5.top[0]?.name,
  r6.read,
  r7.words,
  r8.thread[0]?.depth,
  r9.names,
  r10.views,
  r11.post[0]?.meta.seo.og.card.type,
  p12,
];
