/*
 * The timestamps of `Timestamped` are keyset sort keys (the core always fills them); an optional boolean is
 * not. Every `@ts-expect-error` says what must fail.
 */
import type { AssertEqual, Expect } from "@venloc/typemo-test-kit";
import type { KeysetKey, KeysetSort, Model } from "../../../src/index.ts";
import type { TimedPost } from "../../fixtures/mechanisms/keyset-entities.ts";

export type Keys = [Expect<AssertEqual<KeysetKey<TimedPost>, "_id" | "title" | "createdAt" | "updatedAt">>];

export const newestFirst: KeysetSort<TimedPost> = [["createdAt", -1]];

// @ts-expect-error — `draft` is optional: a missing value cannot be a position
export const byDraft: KeysetSort<TimedPost> = [["draft", 1]];

declare const Posts: Model<TimedPost>;
export const page = Posts.keysetPage({ sort: [["updatedAt", "desc"]], limit: 20 });
