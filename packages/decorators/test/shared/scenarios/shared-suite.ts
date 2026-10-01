/*
 * The shared scenarios, registered by both runners. Same models, same assertions, same golden
 * `describe()` — the only difference between the runs is the decorator mode chosen by the runner's tsconfig.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import * as decorators from "@typemo-shared/decorators";
import { BsonOptions, type Connection, TypemoClient, VersionError } from "@venloc/typemo";
import { expectTypeOf } from "expect-type";
import { testLabelExtension } from "../../../../test-kit/fixtures/extensions/test-label-extension.ts";
import {
  DecoratorContract,
  type DecoratorMode,
  expectHover,
  MongoHarness,
  MongoLifecycle,
  TypeProbe,
} from "../../../../test-kit/src/index.ts";
import { ModelInternals } from "../../../../typemo/src/internal.ts";
/* Internal: the sensitive rules of a compiled schema are not in describe() (the public view of paths). */
import { SensitiveMask } from "../../../../typemo/src/policies/sensitive-mask.ts";
import { probe, SharedAdmin, SharedAuthor, SharedLedger, SharedPerson, SharedPost, trace } from "./models.ts";

/** The golden `describe()` file both modes must match. */
const GOLDEN = resolve(import.meta.dir, "describe.golden.json");

/** The scenarios that run once per decorator mode. */
export class SharedSuite {
  /**
   * Registers the suite for a decorator mode.
   *
   * @param mode - The mode the current runner compiles with.
   */
  static register(mode: DecoratorMode): void {
    const mongo = MongoLifecycle.useMongo(`shared_${mode}`, BsonOptions.apply({}));
    let client: TypemoClient | undefined;
    const connection = (): Connection => {
      if (client === undefined) throw new Error("the client exists only inside tests");
      return client.connection;
    };
    beforeAll(async () => {
      client = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName });
      client.use(testLabelExtension);
      await client.connect();
    });
    afterAll(async () => {
      await client?.close();
    });

    describe(`shared suite [${mode}]`, () => {
      test("the contract: the decorators module exports every name; the transpiler ran the expected mode", () => {
        expect(DecoratorContract.missing(decorators)).toEqual([]);
        expect(DecoratorContract.detectMode(probe.args)).toBe(mode);
      });

      test("describe() of every model equals the golden file (identical in both modes)", () => {
        const described = {
          SharedAuthor: connection().model(SharedAuthor).schema.describe(),
          SharedPost: connection().model(SharedPost).schema.describe(),
          SharedPerson: connection().model(SharedPerson).schema.describe(),
          SharedLedger: connection().model(SharedLedger).schema.describe(),
        };
        const { expected, actual } = DecoratorContract.golden(
          GOLDEN,
          described,
          mode === "legacy" && process.env.TYPEMO_UPDATE_GOLDEN === "1",
        );
        expect(actual).toEqual(expected);
      });

      test("plain fields, nested, arrays, subdocument arrays, Maps, null: round trip on the server", async () => {
        const People = connection().model(SharedPerson);
        const ann = await People.create({
          name: "ann",
          tags: ["a", "b"],
          scores: [1, 2],
          address: { city: "Riga" },
          pets: [{ name: "rex", age: 3 }],
          counters: new Map([["x", 1]]),
          seenAt: null,
        });
        const raw = await mongo.db.collection("shared_people").findOne({ _id: ann._id });
        expect(raw).toMatchObject({ name: "ann", tags: ["a", "b"], scores: [1, 2], address: { city: "Riga" } });
        expect(raw?.seenAt).toBeNull();
        expect(raw?.counters).toEqual({ x: 1 });
        const lean = await People.findById(ann._id).lean();
        expect(lean?.pets?.[0]?.name).toBe("rex");
        expectTypeOf(ann.name).toEqualTypeOf<string>();
      });

      test("hooks (pre/post/postError) and the plugin hook run in order (class hooks, then plugin hooks)", async () => {
        trace.length = 0;
        const People = connection().model(SharedPerson);
        await People.create({ name: "bob" });
        expect(trace).toEqual(["pre save bob", "plugin pre save", "post save bob"]);
        trace.length = 0;
        await People.syncIndexes();
        await People.create({ name: "eve", email: "e@x.io" });
        await expect(People.create({ name: "eve2", email: "e@x.io" })).rejects.toThrow();
        expect(trace).toContain("error save eve2");
      });

      test("refs + populate and a virtual populate", async () => {
        const Authors = connection().model(SharedAuthor);
        const Posts = connection().model(SharedPost);
        const author = await Authors.create({ name: "kim" });
        await Posts.create({ title: "t1", author: author._id });
        const post = await Posts.findOne({ title: "t1" }).populate("author");
        expect((post?.author as { name?: string } | undefined)?.name).toBe("kim");
        const withPosts = await Authors.findById(author._id).populate("posts");
        expect((withPosts?.posts as readonly unknown[] | undefined)?.length).toBe(1);
      });

      test("indexes: the declared ones are built on the server", async () => {
        await connection().model(SharedPost).syncIndexes();
        const names = (await mongo.db.collection("shared_posts").indexes()).map((index) => index.name);
        expect(names).toContain("title_1_views_-1");
      });

      test("sensitive + Mask, ext of the test extension", () => {
        const schema = connection().model(SharedPerson).schema;
        expect(schema.ext).toEqual({ testLabel: { group: "people" } });
        expect(schema.extOf("name")).toEqual({ testLabel: { label: "Name" } });
        const rules = SensitiveMask.paths(ModelInternals.schema(connection().model(SharedPerson)));
        const byPath = Object.fromEntries(rules.map((entry) => [entry.segments.join("."), entry.rule]));
        expect(Object.keys(byPath).sort()).toEqual(["email", "secret"]);
        expect(byPath.secret).toBe("hide");
        /* A Mask.* rule is a function. */
        expect(typeof byPath.email).toBe("function");
      });

      test("hovers: the IDE shows the same model types in this mode (runner tsconfig)", () => {
        const probe = TypeProbe.shared({ tsconfig: resolve(import.meta.dir, "..", mode, "tsconfig.json") });
        const head = `import type { HydratedDoc } from "@venloc/typemo";
import type { SharedPerson, SharedPost } from "./models.ts";
declare const post: HydratedDoc<SharedPost>;
declare const person: HydratedDoc<SharedPerson>;
`;
        const options = { probe, dir: import.meta.dir } as const;
        expectHover(`${head}const views = post.views;\n//    ^?`, options).toBe("const views: number");
        expectHover(`${head}const pets = person.pets;\n//    ^?`, options).toBe(
          "const pets: SubdocumentArray<SharedPet> | undefined",
        );
        expectHover(`${head}const author = post.author;\n//    ^?`, options).toBe("const author: Ref<SharedAuthor>");
      }, 60_000);

      test("discriminators: the child model stores its key in the root collection", async () => {
        const Admins = connection().model(SharedAdmin);
        const admin = await Admins.create({ name: "root", level: 7 });
        const raw = await mongo.db.collection("shared_people").findOne({ _id: admin._id });
        expect(raw).toMatchObject({ __t: "admin", name: "root", level: 7 });
        expect(connection().model(SharedPerson).schema.describe().discriminators).toEqual(["admin"]);
      });

      test("OCC: a stale save is a VersionError", async () => {
        const Ledgers = connection().model(SharedLedger);
        const created = await Ledgers.create({ owner: "a", balance: 1 });
        const first = await Ledgers.findById(created._id);
        const second = await Ledgers.findById(created._id);
        if (first === null || second === null) throw new Error("ledger not found");
        first.balance = 2;
        await first.$save();
        second.balance = 3;
        await expect(second.$save()).rejects.toThrow(VersionError);
      });
    });
  }
}
