/*
 * Keyset fixtures: a `Timestamped` entity (its `createdAt`/`updatedAt` are always filled by the core, so they
 * are sort keys) with an optional boolean, which is not a sort key. Collection names start with `s9_`.
 */
import { Entity, Index, Prop, Schema, Timestamped } from "../../../src/index.ts";

/** A timestamped post: newest first by `createdAt`, an optional `draft` flag. */
@Schema({ collection: "s9_timed_posts" })
@Index({ createdAt: -1, _id: -1 })
export class TimedPost extends Timestamped(Entity) {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Boolean)
  draft?: boolean;

  @Prop(() => String)
  note?: string;
}
