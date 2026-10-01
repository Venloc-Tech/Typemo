import { describe, test } from "bun:test";
import { expectHover, expectNoTypeErrors, expectTypeError, TypeProbe } from "@venloc/typemo-test-kit";

/*
 * The errors of the decorators are readable — the message names the field and the rule — and the IDE shows the
 * markers and specs as expected. Every check runs with emitDecoratorMetadata on (tsconfig.test.json) and off.
 */

const IMPORTS = `
import { ObjectId } from "mongodb";
import {
  Prop, Schema, Index, Virtual, Pre, Entity, Timestamped, Versioned, Spec, Types,
  type Defaulted, type Immutable, type Hidden, type Ref, type VirtualRef, type OperationHookContext,
} from "@venloc/typemo";
@Schema() class Tag { @Prop(() => String) label!: string; }
`;

/** The compiler prints string literal types with escaped quotes: `"@Prop \\"f\\": …"`. */
const printed = (message: string): string => message.replaceAll('\\"', '"').replaceAll('"', '\\"');

const PROBES = [
  ["emitDecoratorMetadata on", TypeProbe.shared()],
  ["emitDecoratorMetadata off", TypeProbe.shared({ compilerOptions: { emitDecoratorMetadata: false } })],
] as const;

for (const [name, probe] of PROBES) {
  describe(`readable decorator errors (${name})`, () => {
    test.each([
      [
        "class A { @Prop(() => Number, { default: 5 }) f!: number; }",
        '@Prop "f": "default" is set, declare the field as Defaulted<T>',
      ],
      [
        "class A { @Prop(() => Number) f!: Defaulted<number>; }",
        '@Prop "f": the field is Defaulted<T>, but "default" is missing',
      ],
      [
        "class A { @Prop(() => String, { immutable: true }) f!: string; }",
        '@Prop "f": "immutable" is set, declare the field as Immutable<T>',
      ],
      ["class A { @Prop(() => String) f!: Hidden<string>; }", '@Prop "f": the field is Hidden<T>, add hidden: true'],
      [
        "class A { @Prop(() => String) f!: string | null; }",
        '@Prop "f": the field type has \\"| null\\", add nullable: true',
      ],
      [
        'class A { @Prop(() => String, { enum: ["a"] }) f!: "a" | "b"; }',
        '@Prop "f": \\"enum\\" values differ from the field\'s literal union',
      ],
      [
        "class A { @Prop(() => String) f!: number; }",
        '@Prop "f": the runtime type () => X does not match the field type',
      ],
      ["class A { @Prop(() => ObjectId) f!: Ref<Tag>; }", '@Prop "f": the field is Ref<Model>, add ref: () => Model'],
      [
        "class A { @Prop(() => String) private f!: string; }",
        "not a public field (private and protected fields cannot be schema fields)",
      ],
      [
        "class A { @Prop(() => Set) f!: Set<string>; }",
        "this type is not supported (no Set/Map/Array/Object: use [X], Spec.map(X) or a @Schema class)",
      ],
    ])("%s", (code, message) => {
      expectTypeError(`${IMPORTS}\n${code}`, { probe }).toContain(printed(message));
    });

    test("an option of another type is an error at its key", () => {
      expectTypeError(`${IMPORTS}\nclass A { @Prop(() => Number, { minLength: 1 }) f!: number; }`, { probe }).toMatch(
        /'minLength' does not exist in type/,
      );
    });

    test("@Index without <T>: the unknown path is named", () => {
      expectTypeError(`${IMPORTS}\n@Index({ nmae: 1 }) @Schema() class A { @Prop(() => String) name?: string; }`, {
        probe,
      }).toContain(printed('@Index: "nmae" is not a field of the class'));
    });

    test("@Virtual flags against VirtualRef", () => {
      expectTypeError(
        `${IMPORTS}\nclass A { @Prop(() => String) x?: string; @Virtual({ ref: () => Tag, localField: "x", foreignField: "label" }) v!: VirtualRef<Tag, true>; }`,
        { probe },
      ).toContain(printed('@Virtual "v": the field is VirtualRef<M, true>, add justOne: true'));
    });

    test("a query hook without an explicit this", () => {
      expectTypeError(`${IMPORTS}\nclass A { @Pre("query.find") scope(): void {} }`, { probe }).toContain(
        "a query/model/aggregate hook must declare this: OperationHookContext<Entity>",
      );
    });

    test("a correct entity compiles cleanly", () => {
      expectNoTypeErrors(
        `${IMPORTS}
@Schema() class User extends Versioned(Timestamped(Entity)) {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { default: 0 }) age!: Defaulted<number>;
  @Prop(() => ObjectId, { ref: () => User, nullable: true }) boss!: Ref<User> | null;
  @Prop(() => [Tag]) tags?: Tag[];
  @Prop(() => Spec.map(Types.Int32)) scores?: Map<string, number>;
  @Pre(["query.find"]) scoped(this: OperationHookContext<User>): void {}
}`,
        { probe },
      );
    });
  });
}

describe("hover", () => {
  test("marker types keep the value type visible (the conditional alias expands)", () => {
    expectHover(`${IMPORTS}
class A { @Prop(() => Number, { default: 1 }) age!: Defaulted<number>; }
declare const a: A;
const age = a.age;
//    ^?`).toBe("const age: number & DefaultedMarker");
  });

  test("service fields of the base classes are visible on the entity", () => {
    expectHover(`${IMPORTS}
@Schema() class User extends Versioned(Timestamped(Entity)) {}
declare const u: User;
const created = u.createdAt;
//    ^?`).toBe("const created: Date & ImmutableMarker & DefaultedMarker");
  });

  test("Spec builders", () => {
    expectHover(`${IMPORTS}
const spec = Spec.map([String]);
//    ^?`).toBe("const spec: MapSpec<readonly [StringConstructor], false>");
    /* the nullable flag of the values is part of the spec type */
    expectHover(`${IMPORTS}
const nullable = Spec.map(Number, { nullable: true });
//    ^?`).toBe("const nullable: MapSpec<NumberConstructor, true>");
  });

  test("Ref<M> is its id type with a phantom model", () => {
    expectHover(`${IMPORTS}
declare const id: Ref<Tag>;
const copy = id;
//    ^?`).toBe("const copy: Ref<Tag>");
  });
});
