import { ObjectId } from "bson";

/**
 * The nested `profile` object of a user.
 *
 * @example
 * ```ts
 * const profile: UserProfile = { bio: "Mathematician" };
 * ```
 */
export interface UserProfile {
  /** Free-form biography. */
  bio?: string;
  /** Avatar image address. */
  avatarUrl?: string;
}

/**
 * User fixture: nested object (`profile`), a `Map` field
 * (`preferences`), and half of the cyclic reference with `Post`
 * (`favoritePostId` <-> `Post.authorId`).
 *
 * @example
 * ```ts
 * const user: UserDocument = UserFixture.build({ name: "Grace" });
 * ```
 */
export interface UserDocument {
  /** Document id. */
  _id: ObjectId;
  /** Display name. */
  name: string;
  /** Email address. */
  email: string;
  /** Free-form tags. */
  tags: string[];
  /** Nested profile object. */
  profile: UserProfile;
  /** Named preferences. */
  preferences: Map<string, string>;
  /** A `Post` id; `null` when none. */
  favoritePostId: ObjectId | null;
  /** Creation time. */
  createdAt: Date;
}

/** Builds `UserDocument` values for tests. */
export class UserFixture {
  /**
   * Builds a user with valid defaults.
   *
   * @param overrides - Fields that replace the defaults.
   * @returns A new user document with a fresh `_id`.
   */
  static build(overrides: Partial<UserDocument> = {}): UserDocument {
    return {
      _id: new ObjectId(),
      name: "Ada Lovelace",
      email: "ada@example.test",
      tags: ["admin"],
      profile: { bio: "Mathematician" },
      preferences: new Map([["theme", "dark"]]),
      favoritePostId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    };
  }
}
