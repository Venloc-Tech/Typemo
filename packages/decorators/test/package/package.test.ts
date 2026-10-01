/*
 * Tests `@venloc/typemo-decorators` (TC39): it compiles the same schema as the core's legacy decorators,
 * works on the real server, and refuses misuse.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  BsonOptions,
  ConfigurationError,
  type Connection,
  Entity,
  type Model,
  type TenantField,
  TypemoClient,
} from "@venloc/typemo";
import { MetadataBuilder } from "@venloc/typemo/adapters";
import { MongoHarness, MongoLifecycle } from "../../../test-kit/src/index.ts";
import * as Decorators from "../../src/index.ts";
import { Prop, Schema, Tenant } from "../../src/index.ts";
import { User } from "./fixtures.ts";

/** Database handles of this file. */
const mongo = MongoLifecycle.useMongo("tc39_pkg", BsonOptions.apply({}));
/** The Typemo client under test. */
let client: TypemoClient;
/** Its connection. */
let connection: Connection;
/** The model of the TC39-decorated `User`. */
let Users: Model<User>;

beforeAll(async () => {
  client = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName });
  await client.connect();
  connection = client.connection;
  Users = connection.model(User);
});

afterAll(async () => {
  await client.close();
});

describe("package surface", () => {
  test("exports the core decorator names", () => {
    for (const name of [
      "Schema",
      "Prop",
      "Virtual",
      "Index",
      "Pre",
      "Post",
      "PostError",
      "Plugin",
      "Discriminator",
      "SearchIndex",
      "Tenant",
    ]) {
      expect(typeof (Decorators as Record<string, unknown>)[name]).toBe("function");
    }
  });

  test("Symbol.metadata is installed on import", () => {
    expect(typeof Symbol.metadata).toBe("symbol");
    expect(User[Symbol.metadata]).toBeObject();
  });
});

describe("same schema as the legacy twin", () => {
  test("describe() equals the legacy-defined model", async () => {
    /* Bun takes the decorator mode from the cwd tsconfig: the twin runs in the core package (legacy). */
    const run = Bun.spawn(["bun", join(import.meta.dir, "legacy-twin.ts")], {
      cwd: join(import.meta.dir, "../../../typemo"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
    expect(code).toBe(0);
    const legacy = JSON.parse(out) as unknown[];
    expect(JSON.parse(JSON.stringify([Users.schema.describe()]))).toEqual(legacy);
  });
});

describe("CRUD on the real server", () => {
  test("insert, hook, find, update, delete", async () => {
    const created = await Users.create({ name: "  Ann ", age: 30, address: { city: " Oslo " }, secret: "x" });
    expect(created.name).toBe("Ann");
    expect([...(created.tags ?? [])]).toEqual(["saved"]);
    const found = await Users.findOne({ name: "Ann" }).lean();
    expect(found?.address?.city).toBe("Oslo");
    await Users.updateOne({ name: "Ann" }, { $set: { age: 31 } });
    expect((await Users.findOne({ name: "Ann" }).lean())?.age).toBe(31);
    await Users.deleteOne({ name: "Ann" });
    expect(await Users.countDocuments({})).toBe(0);
  });

  test("the @Index is created", async () => {
    await Users.syncIndexes();
    const indexes = await mongo.db.collection("tc39_pkg_users").indexes();
    expect(indexes.some((index) => index.unique === true && index.key.name === 1 && index.key.age === -1)).toBe(true);
  });
});

describe("misuse", () => {
  test("@Prop on a #private field is a ConfigurationError", () => {
    expect(() => {
      @Schema()
      class Hidden extends Entity {
        // @ts-expect-error — TC39 knows `private: true` at compile time
        @Prop(() => String) #name?: string;
        read(): string | undefined {
          return this.#name;
        }
      }
      return Hidden;
    }).toThrow(ConfigurationError);
  });

  test("@Prop on a static field is a ConfigurationError", () => {
    expect(() => {
      @Schema()
      class WithStatic extends Entity {
        // @ts-expect-error — static fields are not schema fields
        @Prop(() => String) static label?: string;
      }
      return WithStatic;
    }).toThrow(ConfigurationError);
  });

  test("the type thunk is required", () => {
    expect(() => {
      @Schema()
      class NoType extends Entity {
        // @ts-expect-error — `@Prop()` without `() => T`: TC39 has no design:type
        @Prop() name?: string;
      }
      return NoType;
    }).toThrow();
  });

  test("options are checked against the field type", () => {
    @Schema()
    class Checked extends Entity {
      // @ts-expect-error — `trim` is a string option, the field is a number
      @Prop(() => Number, { trim: true }) count?: number;
    }
    expect(Checked).toBeFunction();
  });

  test("a TC39 decorator applied with legacy arguments is a ConfigurationError", () => {
    /* cast: calls the TC39 decorator the way a legacy transpiler would (target, key). */
    const decorate = Prop(() => String) as unknown as (target: object, key: string) => void;
    expect(() => decorate({}, "name")).toThrow(ConfigurationError);
  });

  test("a core legacy decorator applied as TC39 is a ConfigurationError", async () => {
    const core = await import("@venloc/typemo");
    /* cast: calls the legacy decorator the way a TC39 transpiler would (value, context). */
    const decorate = core.Prop(() => String) as unknown as (value: undefined, context: object) => void;
    expect(() => decorate(undefined, { kind: "field", name: "x", metadata: {} })).toThrow(ConfigurationError);
  });

  test("@Prop on a TS private field is a type error", () => {
    @Schema()
    class Private extends Entity {
      // @ts-expect-error — TS-private keys are not in keyof This (the context says private: false)
      @Prop(() => String) private label?: string;
      read(): string | undefined {
        return this.label;
      }
    }
    expect(Private).toBeFunction();
  });

  test("@Prop(String) instead of a thunk is a ConfigurationError", () => {
    expect(() => {
      @Schema()
      class NotThunk extends Entity {
        // @ts-expect-error — the type argument must be () => T
        @Prop(String) name?: string;
      }
      return NotThunk;
    }).toThrow(ConfigurationError);
  });

  test("@Prop on an accessor is a ConfigurationError", () => {
    expect(() => {
      @Schema()
      class WithAccessor extends Entity {
        // @ts-expect-error — an accessor is not a field decorator target
        @Prop(() => String) accessor name: string | undefined;
      }
      return WithAccessor;
    }).toThrow(ConfigurationError);
  });

  test("legacy metadata on a base and TC39 on the subclass fail at compile", () => {
    class LegacyBase extends Entity {}
    MetadataBuilder.for(LegacyBase).addField("title", () => String);
    @Schema({ collection: "tc39_pkg_mixed" })
    class Mixed extends LegacyBase {
      @Prop(() => String) body?: string;
    }
    expect(() => connection.model(Mixed)).toThrow(/one decorator package per project/);
  });
});

describe("TC39 @Tenant()", () => {
  test("marks the tenant field: the schema compiles and the model fills the field from the operation's tenant", async () => {
    @Schema({ collection: "tc39_pkg_tenant", tenant: true })
    class Note extends Entity {
      @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
      @Prop(() => String, { required: true }) title!: string;
    }
    const Notes = connection.model(Note);
    const note = await Notes.create({ title: "a" }, { policy: { tenant: "acme" } });
    expect(note.tenantId).toBe("acme");
  });

  test("a tenant option whose field is not marked, and a mark without the option, are ConfigurationErrors", () => {
    @Schema({ collection: "tc39_pkg_unmarked", tenant: true })
    class Unmarked extends Entity {
      @Prop(() => String) tenantId!: TenantField<string>;
    }
    expect(() => connection.model(Unmarked)).toThrow(/the tenant field "tenantId" must be marked @Tenant\(\)/);
    /* cast: the run-time rule is tested, not the types (a mark on a plain field) */
    const untyped = Tenant as unknown as () => (value: unknown, context: unknown) => void;
    @Schema({ collection: "tc39_pkg_nopolicy" })
    class NoPolicy extends Entity {
      @Prop(() => String) @untyped() owner!: string;
    }
    expect(() => connection.model(NoPolicy)).toThrow(ConfigurationError);
    expect(() => connection.model(NoPolicy)).toThrow(/@Tenant\(\) on "owner", but the schema has no tenant policy/);
  });
});
