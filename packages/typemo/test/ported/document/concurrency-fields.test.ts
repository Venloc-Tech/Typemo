/*
 * Ported from mongoose test/versioning.test.js ("optimisticConcurrency being an array of strings", the
 * "optimisticConcurrency: string[]" block of gh-15912/gh-15915/gh-16383) and test/model.test.js (gh-16054) onto
 * Typemo's `optimisticConcurrency: [paths]`. Mongoose's `$__delta()`/`$__.version` checks become checks
 * of the update the server received (CommandRecorder): `q.__v` is the version check (VERSION_WHERE), `u.$inc.__v`
 * the increment. One deliberate divergence (from-mongoose-to-typemo/DIVERGENCES.md L5A-14): a save that touches
 * none of the listed paths keeps Typemo's default ARRAY versioning (a positional write is still checked, a length
 * change still counts) — Mongoose drops it; the Mongoose expectation "no version at all" holds here for non-array
 * changes only.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  Entity,
  type Model,
  Prop,
  Schema,
  Spec,
  VersionError,
  Versioned,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema({ collection: "p_occ_things", optimisticConcurrency: ["price", "name"] })
class Thing extends Versioned(Entity) {
  @Prop(() => Number)
  price?: number;

  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "p_occ_users_balance", optimisticConcurrency: ["balance"] })
class BalanceUser extends Versioned(Entity) {
  @Prop(() => String)
  name?: string;

  @Prop(() => Number)
  balance?: number;

  @Prop(() => [String])
  friends!: string[];
}

@Schema({ collection: "p_occ_users_friends", optimisticConcurrency: ["friends"] })
class FriendsUser extends Versioned(Entity) {
  @Prop(() => String)
  name?: string;

  @Prop(() => Number)
  balance?: number;

  @Prop(() => [String])
  friends!: string[];
}

@Schema({ collection: "p_occ_settings", optimisticConcurrency: ["settings.$*"] })
class SettingsUser extends Versioned(Entity) {
  @Prop(() => Spec.map(String))
  settings?: Map<string, string>;

  @Prop(() => Number)
  balance?: number;
}

@Schema()
class PostComment {
  @Prop(() => String)
  text?: string;

  @Prop(() => String)
  author?: string;
}

@Schema({ collection: "p_occ_posts", optimisticConcurrency: ["comments.text"] })
class Post extends Versioned(Entity) {
  @Prop(() => String)
  title?: string;

  @Prop(() => [PostComment])
  comments!: PostComment[];
}

@Schema({ nested: true })
class Profile {
  @Prop(() => String)
  firstName?: string;

  @Prop(() => String)
  lastName?: string;
}

@Schema({ collection: "p_occ_profiles", optimisticConcurrency: ["profile.firstName"] })
class ProfileUser extends Versioned(Entity) {
  @Prop(() => Profile)
  profile?: Profile;

  @Prop(() => Number)
  balance?: number;
}

const t = ModelLifecycle.useTypemo("ported_occ_fields");
let Things: Model<Thing>;

beforeEach(() => {
  Things = t.connection.model(Thing);
  t.commands.clear();
});

/** The last update the server received: its filter's version and its increment. */
const lastVersioning = () => {
  const sent = t.commands.byName("update").at(-1)?.command.updates[0] as
    | { q: Record<string, unknown>; u: Record<string, Record<string, unknown> | undefined> }
    | undefined;
  return { where: sent?.q.__v, increment: sent?.u.$inc?.__v };
};

describe("optimisticConcurrency: string[] (ported)", () => {
  // ported from mongoose test/versioning.test.js:515 "should support optimisticConcurrency being an array of strings"
  test("should support optimisticConcurrency being an array of strings", async () => {
    const thing = await Things.create({ price: 1, name: "Test" });
    await thing.$save();
    expect(thing.__v).toBe(0);
    const thing1 = await Things.findById(thing._id).orFail();
    const thing2 = await Things.findById(thing._id).orFail();
    thing1.price = 2;
    thing1.name = "Testerson";
    await thing1.$save();
    expect(thing1.__v).toBe(1);
    // Mongoose: setting the values read before is no change (no error); in Typemo too (L5A-1: nothing is sent)
    thing2.price = 1;
    thing2.name = "Test";
    await thing2.$save();
    // a REAL change of a listed field of the stale document is refused
    thing2.price = 3;
    await expect(thing2.$save()).rejects.toBeInstanceOf(VersionError);
  });

  // ported from mongoose test/versioning.test.js:768 "sets VERSION_ALL when modifying specified field"
  test("sets VERSION_ALL when modifying specified field", async () => {
    const user = await t.connection
      .model(BalanceUser)
      .create({ name: "test", balance: 100, friends: ["alice", "bob"] });
    user.balance = 200;
    await user.$save();
    expect(lastVersioning()).toEqual({ where: 0, increment: 1 });
  });

  // ported from mongoose test/versioning.test.js:780 "sets VERSION_ALL when modifying specified array field"
  test("sets VERSION_ALL when modifying specified array field", async () => {
    const user = await t.connection
      .model(FriendsUser)
      .create({ name: "test", balance: 100, friends: ["alice", "bob"] });
    user.friends.push("c");
    await user.$save();
    expect(lastVersioning()).toEqual({ where: 0, increment: 1 });
  });

  // ported from mongoose test/versioning.test.js:792 "does not set version when modifying non-specified field"
  test("does not set version when modifying non-specified field", async () => {
    const user = await t.connection
      .model(BalanceUser)
      .create({ name: "test", balance: 100, friends: ["alice", "bob"] });
    user.name = "changed";
    await user.$save();
    expect(lastVersioning()).toEqual({ where: undefined, increment: undefined });
  });

  // ported from mongoose test/versioning.test.js:804 "does not set version when modifying non-specified array field"
  test("does not set version when modifying non-specified array field — L5A-14: the array versioning stays", async () => {
    const user = await t.connection
      .model(BalanceUser)
      .create({ name: "test", balance: 100, friends: ["alice", "bob"] });
    user.friends.push("new-friend");
    await user.$save();
    // Mongoose: no version at all. Typemo: no version CHECK (not a listed path), but the length change still counts
    // (the default array versioning a list never switches off, from-mongoose-to-typemo/DIVERGENCES.md L5A-14)
    expect(lastVersioning()).toEqual({ where: undefined, increment: 1 });
  });

  // ported from mongoose test/versioning.test.js:815 "sets VERSION_ALL when modifying a map key matching a wildcard path (gh-16383)"
  test("H017: sets VERSION_ALL when modifying a map key matching a wildcard path (gh-16383)", async () => {
    const user = await t.connection.model(SettingsUser).create({ settings: { theme: "dark" }, balance: 100 });
    user.settings?.set("theme", "light");
    await user.$save();
    expect(lastVersioning()).toEqual({ where: 0, increment: 1 });
  });

  // ported from mongoose test/versioning.test.js:832 "sets VERSION_ALL when modifying array element path matching a subdocument path (gh-16383)"
  test("sets VERSION_ALL when modifying array element path matching a subdocument path (gh-16383)", async () => {
    const post = await t.connection.model(Post).create({ title: "Hello", comments: [{ text: "First" }] });
    const [first] = post.comments;
    if (first === undefined) throw new Error("no comment");
    first.text = "Edited";
    await post.$save();
    expect(lastVersioning()).toEqual({ where: 0, increment: 1 });
  });

  // ported from mongoose test/versioning.test.js:849 "does not set version when modifying non-specified subdocument path (gh-16383)"
  test("does not set version when modifying non-specified subdocument path — L5A-14: a positional write stays checked", async () => {
    const post = await t.connection.model(Post).create({ title: "Hello", comments: [{ text: "First", author: "A" }] });
    const [first] = post.comments;
    if (first === undefined) throw new Error("no comment");
    first.author = "B";
    await post.$save();
    // Mongoose: no version. Typemo: `comments.0.author` is a positional write — checked against the version read
    // (Mongoose H513: otherwise another element is written after a concurrent removal), not incremented
    expect(lastVersioning()).toEqual({ where: 0, increment: undefined });
  });

  // ported from mongoose test/versioning.test.js:866 "does not set version when modifying non-specified field with wildcard path (gh-16383)"
  test("does not set version when modifying non-specified field with wildcard path (gh-16383)", async () => {
    const user = await t.connection.model(SettingsUser).create({ settings: { theme: "dark" }, balance: 100 });
    user.balance = 200;
    await user.$save();
    expect(lastVersioning()).toEqual({ where: undefined, increment: undefined });
  });

  // ported from mongoose test/model.test.js:3117 "should include __v when optimisticConcurrency array contains a parent path and subdocument is modified (gh-16054)"
  test("should include __v when optimisticConcurrency array contains a parent path and subdocument is modified (gh-16054)", async () => {
    const user = await t.connection
      .model(ProfileUser)
      .create({ profile: { firstName: "Alice", lastName: "Smith" }, balance: 100 });
    user.$set("profile", { firstName: "Val" });
    await user.$save();
    expect(lastVersioning()).toEqual({ where: 0, increment: 1 });
    // a listed nested path itself
    const again = await t.connection.model(ProfileUser).findById(user._id).orFail();
    again.$set("profile.firstName", "Kim");
    await again.$save();
    expect(lastVersioning()).toEqual({ where: 1, increment: 1 });
    // a sibling of the listed path: no version
    again.$set("profile.lastName", "Lee");
    await again.$save();
    expect(lastVersioning()).toEqual({ where: undefined, increment: undefined });
  });
});

describe("optimisticConcurrency: paths are checked", () => {
  test("a path that is not the class's is a ConfigurationError when the model is created", () => {
    // @ts-expect-error — the type refuses it too: "optimisticConcurrency names "price", which is not a path of the class"
    @Schema({ collection: "p_occ_bad", optimisticConcurrency: ["price"] })
    class Bad extends Versioned(Entity) {
      @Prop(() => Number)
      cost?: number;
    }
    expect(() => t.connection.model(Bad)).toThrow(ConfigurationError);
    expect(() => t.connection.model(Bad)).toThrow(/optimisticConcurrency names "price"/);
  });

  test("a Map is named by its values (settings.$*), a subdocument array by its fields (comments.text)", () => {
    expect(() => t.connection.model(SettingsUser)).not.toThrow();
    expect(() => t.connection.model(Post)).not.toThrow();
  });
});
