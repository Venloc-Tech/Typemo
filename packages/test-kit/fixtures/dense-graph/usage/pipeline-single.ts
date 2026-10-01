/* One realistic aggregation: match → lookup → unwind → group with accumulators → sort. */
import { fn, Pipeline, type RowOf } from "@venloc/typemo";
import { Post, User } from "../entities.ts";

const byAuthor = Pipeline.from(Post)
  .match({ status: "published" })
  .lookup({ from: User, localField: "author", foreignField: "_id", as: "writer" })
  .unwind("$writer")
  .group((f) => ({ _id: f.writer.name, posts: fn.count(), views: fn.sum(f.meta.views), last: fn.max(f.publishedAt) }))
  .sort({ views: -1 });

export const readSingle = (row: RowOf<typeof byAuthor>): number => row.views + row.posts;
