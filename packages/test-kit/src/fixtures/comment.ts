import { ObjectId } from "bson";

/**
 * Comment fixtures model a discriminator: a `kind` field picks
 * between two shapes that share a common base. They are plain TS classes
 * with no schema decorators, so runtime tests and shape tests have something
 * concrete to point at.
 *
 * `authorId`/`postId` close the cyclic reference graph together with
 * `fixtures/user.ts` and `fixtures/post.ts`: User -favoritePostId-> Post
 * -authorId-> User, and Comment -authorId-> User, Comment -postId-> Post.
 *
 * @example
 * ```ts
 * const base: BaseCommentFields = CommentFixture.text();
 * ```
 */
export interface BaseCommentFields {
  /** Document id. */
  _id: ObjectId;
  /** The user who wrote the comment. */
  authorId: ObjectId;
  /** The post the comment belongs to. */
  postId: ObjectId;
  /** Creation time. */
  createdAt: Date;
}

/** A text comment (`kind: "text"`). */
export class TextComment implements BaseCommentFields {
  /** Discriminator value. */
  readonly kind = "text" as const;
  /**
   * @param _id - Document id.
   * @param authorId - The author.
   * @param postId - The post.
   * @param body - The comment text.
   * @param createdAt - Creation time.
   */
  constructor(
    public _id: ObjectId,
    public authorId: ObjectId,
    public postId: ObjectId,
    public body: string,
    public createdAt: Date,
  ) {}
}

/** An image comment (`kind: "image"`). */
export class ImageComment implements BaseCommentFields {
  /** Discriminator value. */
  readonly kind = "image" as const;
  /**
   * @param _id - Document id.
   * @param authorId - The author.
   * @param postId - The post.
   * @param imageUrl - Image address.
   * @param caption - Optional caption.
   * @param createdAt - Creation time.
   */
  constructor(
    public _id: ObjectId,
    public authorId: ObjectId,
    public postId: ObjectId,
    public imageUrl: string,
    public caption: string | undefined,
    public createdAt: Date,
  ) {}
}

/**
 * Either kind of comment.
 *
 * @example
 * ```ts
 * const comments: Comment[] = [CommentFixture.text(), CommentFixture.image()];
 * ```
 */
export type Comment = TextComment | ImageComment;

/** Builds comments for tests. */
export class CommentFixture {
  /**
   * Builds a text comment.
   *
   * @param overrides - Fields that replace the defaults.
   * @returns A new text comment.
   */
  static text(overrides: Partial<Omit<TextComment, "kind">> = {}): TextComment {
    return new TextComment(
      overrides._id ?? new ObjectId(),
      overrides.authorId ?? new ObjectId(),
      overrides.postId ?? new ObjectId(),
      overrides.body ?? "Nice post!",
      overrides.createdAt ?? new Date("2026-01-02T00:00:00.000Z"),
    );
  }

  /**
   * Builds an image comment.
   *
   * @param overrides - Fields that replace the defaults.
   * @returns A new image comment.
   */
  static image(overrides: Partial<Omit<ImageComment, "kind">> = {}): ImageComment {
    return new ImageComment(
      overrides._id ?? new ObjectId(),
      overrides.authorId ?? new ObjectId(),
      overrides.postId ?? new ObjectId(),
      overrides.imageUrl ?? "https://example.test/image.png",
      overrides.caption,
      overrides.createdAt ?? new Date("2026-01-02T00:00:00.000Z"),
    );
  }
}
