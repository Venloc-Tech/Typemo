import { describe, expect, test } from "bun:test";
import { TypeProbe } from "../../src/hover/type-probe.ts";
import { ShapeFormat } from "../../src/shape/shape.ts";
import { ShapeCompare } from "../../src/shape/shape-harness.ts";

/* Tests `TypeShape`: shapes of compiler types, read through the `TypeProbe`. */

/** Source of the entities whose types are read. */
const ENTITIES = `
import type { Decimal128, ObjectId, UUID, WithId, Collection } from "mongodb";

export class User {
  _id!: ObjectId;
  name!: string;
  age?: number;
  nickname?: string | undefined;
  readonly createdAt!: Date;
  tags: string[] = [];
  balance!: Decimal128;
  externalId!: UUID;
  profile!: { city: string | null; zip?: string };
  settings!: Record<string, boolean>;
  role!: "admin" | "user";
  email!: string & { readonly __brand: "Email" };
  get displayName(): string { return this.name; }
  greet(): string { return "hi " + this.name; }
}
declare const users: Collection<User>;
`;

/**
 * The printed shape of a type or expression.
 *
 * @param target - The snippet and the type, expression or marker to read.
 * @returns The printed shape.
 */
const typeShape = (target: { type?: string; expr?: string; code?: string }): string => {
  const source = TypeProbe.shared().check(target.code ?? ENTITIES);
  return ShapeFormat.print(ShapeCompare.typeShapeOf(source, target));
};

describe("TypeShape", () => {
  test("a TS class entity: fields, optional, BSON classes, literals widened, brands unwrapped", () => {
    expect(typeShape({ type: "User" })).toBe(
      "{ _id: ObjectId; age?: number; balance: Decimal128; createdAt: date; displayName?: string; " +
        "email: string; externalId: Binary; name: string; nickname?: string | undefined; " +
        "profile: { city: string | null; zip?: string }; role: string; " +
        "settings: { [key: string]: boolean }; tags: string[] }",
    );
  });

  test("methods are not data; a getter-only property is optional (never stored)", () => {
    const shape = typeShape({ type: "User" });
    expect(shape).not.toContain("greet");
    expect(shape).toContain("displayName?: string");
  });

  test("exactOptionalPropertyTypes: `age?: number` does not admit undefined, `?: T | undefined` does", () => {
    const shape = typeShape({ type: "User" });
    expect(shape).toContain("age?: number;");
    expect(shape).toContain("nickname?: string | undefined;");
  });

  test("a driver result type: promise awaited, union with null kept", () => {
    expect(typeShape({ expr: "users.findOne({})" })).toMatch(/^\{ _id: ObjectId; age\?: number;.* \| null$/);
  });

  test("arrays, tuples, readonly arrays and unknown/any", () => {
    const code =
      "declare const t: [number, string]; declare const r: readonly Date[]; declare const u: unknown; declare const a: any;";
    expect(typeShape({ code, expr: "t" })).toBe("(number | string)[]");
    expect(typeShape({ code, expr: "r" })).toBe("date[]");
    expect(typeShape({ code, expr: "u" })).toBe("unknown");
    expect(typeShape({ code, expr: "a" })).toBe("any");
  });

  test("the type under a `// ^?` marker", () => {
    const code = "const point = { x: 1, y: null as number | null };\n//    ^?";
    expect(typeShape({ code })).toBe("{ x: number; y: number | null }");
  });

  test("recursive types are cut (the cut point accepts anything)", () => {
    const code = "interface Node { value: number; children: Node[] }";
    expect(typeShape({ code, type: "Node" })).toBe("{ children: unknown[]; value: number }");
  });
});
