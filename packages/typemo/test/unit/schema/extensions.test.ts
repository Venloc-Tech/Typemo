/*
 * Schema extensions. The registry is per client (on its `CompileContext`), so the compile flow runs IN PROCESS
 * with a context of its own; only the global registry (`Typemo.use`, sealed by a compile without a client) needs
 * its own process (test/fixtures/scripts/extensions.ts).
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { testLabelExtension, testLabelSeen } from "../../../../test-kit/fixtures/extensions/test-label-extension.ts";
import { ConfigurationError } from "../../../src/index.ts";
import { type CompileContext, SchemaCompiler } from "../../../src/internal.ts";
/* Internal: the registry class is not public (only Typemo.use, client.use and the types are). */
import { ExtensionRegistry } from "../../../src/schema/extensions/extension-registry.ts";
import {
  Admin,
  EXT_SAMPLE,
  Invalid,
  InvalidSchema,
  Person,
  Unregistered,
} from "../../fixtures/extensions/extension-schemas.ts";

const PACKAGE_DIR = resolve(import.meta.dir, "../../..");

const errorOf = (run: () => unknown): { readonly message: string; readonly cause: string | undefined } => {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    return { message: error.message, cause: error.cause instanceof Error ? error.cause.message : undefined };
  }
  throw new Error("expected a ConfigurationError");
};

describe("schema extensions of one client (in process: use, compile, describe)", () => {
  /* What `client.use()` fills: a registry over the global one, on the client's compile context. */
  const registry = new ExtensionRegistry("client.use()", ExtensionRegistry.global);
  const context: CompileContext = Object.freeze({ extensions: registry });
  registry.use(testLabelExtension);
  const duplicate = errorOf(() => registry.use({ ...testLabelExtension }));
  const noValidators = errorOf(() => registry.use({ name: "empty" } as never));
  const person = SchemaCompiler.compile(Person, context);
  const admin = SchemaCompiler.compile(Admin, context);
  const described = person.describe();
  const late = errorOf(() => registry.use({ name: "late", validateProp: () => undefined } as never));

  test("a repeated name, an extension without validators and a late registration are ConfigurationErrors", () => {
    expect(duplicate.message).toBe('extension "testLabel" is already registered');
    expect(noValidators.message).toContain("needs validateProp, validateSchema or both");
    expect(late.message).toContain("extensions are fixed once a schema is compiled (Person was); call client.use()");
  });

  test("a failed compile leaves the registry open: the extension can still be registered, then the compile passes", () => {
    const fresh = new ExtensionRegistry("client.use()", ExtensionRegistry.global);
    const freshContext: CompileContext = Object.freeze({ extensions: fresh });
    expect(errorOf(() => SchemaCompiler.compile(Person, freshContext)).message).toBe(
      'Person: ext "testLabel" is not a registered extension; register it before the first model with client.use() (for the models of one client) or Typemo.use() (for every client)',
    );
    fresh.use(testLabelExtension);
    expect(SchemaCompiler.compile(Person, freshContext).describe().ext).toBeDefined();
    expect(errorOf(() => fresh.use({ name: "later", validateProp: () => undefined } as never)).message).toContain(
      "extensions are fixed once a schema is compiled (Person was)",
    );
  });

  test("another context does not know the client's extension", () => {
    expect(errorOf(() => SchemaCompiler.compile(Person, Object.freeze({}))).message).toBe(
      'Person: ext "testLabel" is not a registered extension; register it before the first model with client.use() (for the models of one client) or Typemo.use() (for every client)',
    );
  });

  test("JS without types: an unregistered key and an invalid value fail the compile (the extension's error is the cause)", () => {
    expect(errorOf(() => SchemaCompiler.compile(Unregistered, context)).message).toBe(
      'Unregistered.name: ext "nope" is not a registered extension; register it before the first model with client.use() (for the models of one client) or Typemo.use() (for every client)',
    );
    expect(errorOf(() => SchemaCompiler.compile(Invalid, context))).toEqual({
      message: 'Invalid.name: ext "testLabel" is invalid: testLabel: { label: non-empty string } expected',
      cause: "testLabel: { label: non-empty string } expected",
    });
    expect(errorOf(() => SchemaCompiler.compile(InvalidSchema, context))).toEqual({
      message: 'InvalidSchema: ext "testLabel" is invalid: testLabel: { group: string } expected',
      cause: "testLabel: { group: string } expected",
    });
  });

  test("ext of fields and schemas: frozen copies, through nested objects, subdocument arrays, Maps, discriminators", () => {
    expect(person.ext).toEqual({ testLabel: { group: "people" } });
    expect(admin.ext).toEqual({ testLabel: { group: "people" } });
    expect(admin.extOf("level")).toEqual({ testLabel: { label: "Level" } });
    expect((person.extOf("email")?.testLabel as { label?: string } | undefined)?.label).toBe("Email");
    expect((person.extOf("email")?.testLabel as { sample?: unknown } | undefined)?.sample).toBe(EXT_SAMPLE.sample);
    expect(Object.isFrozen(person.extOf("email")?.testLabel)).toBe(true);
    expect(Object.isFrozen(EXT_SAMPLE)).toBe(false);
    expect(person.extOf("pets.3.name")).toEqual({ testLabel: { label: "Pet name" } });
    expect(person.extOf("address.city")).toEqual({ testLabel: { label: "City" } });
    expect(person.extOf("scores")).toEqual({ testLabel: { label: "Scores" } });
    expect(person.extOf("plain")).toEqual({});
    expect(person.extOf("nope")).toBeUndefined();
    /* The array keeps its ext; the element node does not get a copy. */
    expect(person.extOf("tags.0")).toEqual({});
    expect(person.toDbPath("email")).toBe("em");
  });

  test("describe() exposes ext of paths and of the schema", () => {
    expect(
      Object.fromEntries(
        Object.entries(described.paths)
          .filter(([, path]) => path.ext !== undefined)
          .map(([key, path]) => [key, (path.ext?.testLabel as { label?: string } | undefined)?.label]),
      ),
    ).toEqual({
      email: "Email",
      tags: "Tags",
      "address.city": "City",
      "pets.$.name": "Pet name",
      scores: "Scores",
    });
    expect(described.ext).toEqual({ testLabel: { group: "people" } });
  });

  test("the validators see where the value is declared (code and db path, kind; discriminator)", () => {
    expect(testLabelSeen).toContain("prop Person.email email->em scalar");
    expect(testLabelSeen).toContain("schema Person document -");
    expect(testLabelSeen).toContain("schema Admin document admin");
    expect(testLabelSeen).toContain("prop Person.scores scores->scores map");
  });
});

describe("the global registry (own process: Typemo.use)", async () => {
  const run = Bun.spawn(["bun", "run", "test/fixtures/scripts/extensions.ts"], {
    cwd: PACKAGE_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  const result = (code === 0 ? JSON.parse(out) : {}) as Record<string, unknown>;

  test("the script ran", () => {
    expect(err).toBe("");
    expect(code).toBe(0);
  });

  test("a failed compile leaves the global and the client registries open", () => {
    expect(result.failedCompile).toContain("notRegisteredYet");
    expect(result.earlySeesGlobal).toEqual({ testLabel: { label: "Email" } });
  });

  test("the first successful compile fixes the client registry", () => {
    expect(result.lateOnLibrary).toContain("(LibraryThing was); call client.use() before the first model");
  });

  test("a repeated name (globally or on a client) and an extension without validators are refused", () => {
    expect(result.duplicate).toBe('extension "testLabel" is already registered');
    expect(result.duplicateOnClient).toBe('extension "testLabel" is already registered');
    expect(result.noValidators).toContain("needs validateProp, validateSchema or both");
  });

  test("the first successful compile on any client fixes the global list, like Typemo.plugin; a client still registers its own", () => {
    expect(result.lateGlobal).toContain("(Labeled was); call Typemo.use() before the first model");
    expect(result.freshNames).toEqual(["testLabel", "ownAfterGlobalSealed"]);
  });
});

describe("ExtensionRegistry (local)", () => {
  const field = { where: "C.f", path: "f", dbPath: "f", kind: "scalar" };
  const schema = { name: "C", kind: "document", discriminator: undefined } as const;

  test("a key used on the wrong level is refused; ext must be an object", () => {
    const registry = new ExtensionRegistry("client.use()", undefined);
    registry.use({ name: "onlySchema", validateSchema: () => undefined } as never);
    expect(() => registry.prop({ onlySchema: {} }, field)).toThrow('extension "onlySchema" has no field options');
    expect(() => registry.prop("x", field)).toThrow(ConfigurationError);
    expect(registry.schema({ onlySchema: { a: [1] } }, schema)).toEqual({ onlySchema: { a: [1] } });
    expect(registry.prop(undefined, field)).toBeUndefined();
  });

  test("a validator cannot change the stored value (it gets the frozen copy)", () => {
    const registry = new ExtensionRegistry("client.use()", undefined);
    registry.use({
      name: "mutator",
      validateProp: (value: unknown) => {
        (value as { x: number }).x = 2;
      },
    } as never);
    expect(() => registry.prop({ mutator: { x: 1 } }, field)).toThrow(ConfigurationError);
  });

  test("names: a name starting with $ or empty is refused", () => {
    const registry = new ExtensionRegistry("client.use()", undefined);
    expect(() => registry.use({ name: "$x", validateProp: () => undefined } as never)).toThrow(ConfigurationError);
    expect(() => registry.use({ name: "", validateProp: () => undefined } as never)).toThrow(ConfigurationError);
    registry.use({ name: "a", validateProp: () => undefined } as never);
    expect(registry.names).toEqual(["a"]);
  });
});
