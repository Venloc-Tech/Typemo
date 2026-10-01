import { describe, expect, test } from "bun:test";
import { expectHover, expectNoTypeErrors, expectTypeError } from "../../src/hover/hover-expect.ts";
import { TypeProbe } from "../../src/hover/type-probe.ts";

/* Tests `TypeProbe`: `// ^?` markers, typeOf, hover snapshots and readable type errors. */

/** The shared probe every test reuses. */
const probe = TypeProbe.shared();

describe("TypeProbe basics", () => {
  test("shared() returns one cached language service per configuration", () => {
    expect(TypeProbe.shared()).toBe(probe);
    expect(TypeProbe.shared({ compilerOptions: { strict: false } })).not.toBe(probe);
  });

  test("the probe uses tsconfig.test.json: strict flags and legacy decorators are on", () => {
    expect(probe.compilerOptions.exactOptionalPropertyTypes).toBe(true);
    expect(probe.compilerOptions.experimentalDecorators).toBe(true);
    expect(probe.compilerOptions.emitDecoratorMetadata).toBe(true);
  });

  test("hover at a marker is the IDE quick info", () => {
    expectHover(`
const user = { name: "Ann", age: 3 as number | null };
//    ^?
`).toBe("const user: { name: string; age: number | null; }");
  });

  test("several markers: hovers() in order, hover(n) for one", () => {
    const source = probe.check(`
const ids = [1, 2];
//    ^?
const first = ids[0];
//    ^?
`);
    expect(source.hovers()).toEqual(["const ids: number[]", "const first: number | undefined"]);
    expect(source.hover(1)).toBe("const first: number | undefined");
    expect(() => source.hover()).toThrow(/2 markers/);
  });

  test("typeOf evaluates an expression after the snippet, untruncated, alias expanded", () => {
    const source = probe.check(`
interface User { name: string; tags: string[] }
type Named = Pick<User, "name">;
declare const named: Named;
`);
    /* InTypeAlias: the queried alias is printed as its body; the hover shows the alias name. */
    expect(source.typeOf("named")).toBe("{ name: string; }");
    expect(source.quickInfoAt(source.code.indexOf("named:"))).toBe("const named: Named");
    expect(source.typeOf("named.name.length")).toBe("number");
    expect(source.expandType("Named")).toBe("{ name: string; }");
    expect(source.typeOf("[1, 'a'] as const")).toBe('readonly [1, "a"]');
  });

  test("no truncation: very large types are printed in full", () => {
    const fields = Array.from({ length: 60 }, (_, i) => `field${i}: string;`).join(" ");
    const source = probe.check(`declare const big: { ${fields} };\n//            ^?`);
    const hover = source.hover();
    expect(hover).toContain("field59: string;");
    expect(hover).not.toContain("...");
    expect(source.typeOf("big")).toContain("field59: string;");
  });

  test("resolves workspace packages through tsconfig paths (@venloc/typemo)", () => {
    expectHover(`
import { VERSION } from "@venloc/typemo";
const version = VERSION;
//    ^?
`).toBe('const version: "0.0.0"');
  });

  test("resolves the mongodb driver's types (from the test-kit package)", () => {
    expectHover(`
import type { Collection, ObjectId } from "mongodb";
interface User { _id: ObjectId; name: string }
declare const users: Collection<User>;
const found = await users.findOne({ name: "a" });
//    ^?
`).toBe("const found: WithId<User> | null");
  });

  test("legacy decorators with metadata compile", () => {
    expectNoTypeErrors(`
const Prop = (): PropertyDecorator => () => {};
class User {
  @Prop() name!: string;
}
export { User };
`);
  });

  test("snippets queried in between do not leak into each other", () => {
    const a = probe.check("const a = 1;\n//    ^?");
    const b = probe.check('const b = "x";\n//    ^?');
    expect(a.hover()).toBe("const a: 1");
    expect(b.hover()).toBe('const b: "x"');
    expect(a.hover()).toBe("const a: 1");
  });

  test("a snippet can live next to the test to import local files", () => {
    expectHover(
      `
import { HoverText } from "../../src/hover/hover-text.ts";
const normalize = HoverText.normalize;
//    ^?
`,
      { dir: import.meta.dir },
    ).toBe("const normalize: (text: string) => string");
  });
});

describe("expectHover", () => {
  test("toBe normalizes whitespace of the expected text", () => {
    expectHover("const p = { x: 1, y: 2 };\n//    ^?").toBe(`
      const p: {
        x: number;
        y: number;
      }
    `);
  });

  test("toContain / toMatch", () => {
    const hover = expectHover("const list = new Map<string, Date[]>();\n//    ^?");
    hover.toContain("Map<string, Date[]>");
    hover.toMatch(/^const list: Map</);
  });

  test("sortUnion makes the top-level union order irrelevant", () => {
    expectHover("declare const v: string | null | number;\n//            ^?", { sortUnion: true }).toBe(
      "const v: null | number | string",
    );
  });

  test("a wrong expectation fails (negative)", () => {
    expect(() => expectHover("const n = 1 as number;\n//    ^?").toBe("const n: string")).toThrow();
    expect(() => expectHover("const n = 1;").toBe("const n: 1")).toThrow(/no `\/\/ \^\?` marker/);
  });

  test("snapshot for a large type (bun __snapshots__)", () => {
    expectHover(`
import type { ObjectId, WithId } from "mongodb";
interface Order { _id: ObjectId; total: number; status: "new" | "paid"; lines: { sku: string; qty: number }[] }
type Expanded = { [K in keyof WithId<Order>]: WithId<Order>[K] };
//   ^?
`).toMatchSnapshot();
  });
});

describe("expectTypeError", () => {
  test("toContain checks the (untruncated) message text", () => {
    expectTypeError(`
interface User { name: string }
const user: User = { nmae: "x" };
`).toContain("Object literal may only specify known properties, and 'nmae' does not exist in type 'User'");
  });

  test("toHaveCode / toMatch", () => {
    const error = expectTypeError("const n: number = 'one';");
    error.toHaveCode(2322);
    error.toMatch(/Type 'string' is not assignable to type 'number'/);
  });

  test("fails when the snippet compiles (negative)", () => {
    expect(() => expectTypeError("const n: number = 1;").toContain("anything")).toThrow(
      /the snippet compiles without errors/,
    );
  });

  test("fails with every diagnostic listed when the message differs (negative)", () => {
    expect(() => expectTypeError("const n: number = 'one';").toContain('Unknown field "nmae"')).toThrow(
      /TS2322 \(1:7\): Type 'string' is not assignable/,
    );
  });

  test("expectNoTypeErrors fails with diagnostics (negative)", () => {
    expect(() => expectNoTypeErrors("const n: number = 'one';")).toThrow(/TS2322/);
  });
});
