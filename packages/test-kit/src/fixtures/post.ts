import { ObjectId } from "bson";
import type { Comment } from "./comment.ts";

/**
 * Post fixture: array of embedded subdocuments (`comments`), a
 * `Map` field (`stats`), and half of the cyclic reference with `User`
 * (`authorId` <-> `User.favoritePostId`).
 *
 * @example
 * ```ts
 * const post: PostDocument = PostFixture.build({ title: "Custom" });
 * ```
 */
export interface PostDocument {
  /** Document id. */
  _id: ObjectId;
  /** The author (a `User` id). */
  authorId: ObjectId;
  /** Post title. */
  title: string;
  /** Post body. */
  body: string;
  /** Free-form tags. */
  tags: string[];
  /** Embedded comments. */
  comments: Comment[];
  /** Named counters. */
  stats: Map<string, number>;
  /** Publication time; `null` for a draft. */
  publishedAt: Date | null;
}

/** Builds `PostDocument` values for tests. */
export class PostFixture {
  /**
   * Builds a post with valid defaults.
   *
   * @param overrides - Fields that replace the defaults.
   * @returns A new post document with a fresh `_id`.
   */
  static build(overrides: Partial<PostDocument> = {}): PostDocument {
    return {
      _id: new ObjectId(),
      authorId: new ObjectId(),
      title: "Hello Typemo",
      body: "A native, from-scratch ODM for MongoDB.",
      tags: ["typemo", "mongodb"],
      comments: [],
      stats: new Map([
        ["likes", 0],
        ["shares", 0],
      ]),
      publishedAt: null,
      ...overrides,
    };
  }
}
