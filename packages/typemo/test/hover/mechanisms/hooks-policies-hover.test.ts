import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the hook context (`this`, `skip`, the post result), the plugin statics of
 * `model.statics(plugin)`, the policy values, `$updateOne`, and the readable errors.
 */

const IMPORTS = `
import { ObjectId } from "mongodb";
import {
  Entity, Prop, Schema, Pre, Post, type Model, type OperationHookContext, type SchemaPlugin, type HydratedDoc,
  type DiscriminatorValue, Discriminator, type Lean,
} from "@venloc/typemo";
@Schema() class Item extends Entity { @Prop(() => String, { required: true }) name!: string; }
`;

describe("hover: hooks", () => {
  test("this of a query hook is OperationHookContext<Item, event>", () => {
    expectHover(`${IMPORTS}
class Hooks {
  @Pre("query.find") pre(this: OperationHookContext<Item, "query.find">): void {
    const self = this;
//        ^?
    void self;
  }
}`).toBe('const self: OperationHookContext<Item, "query.find">');
  });

  test("skip(result) of a find hook takes the lean documents", () => {
    expectHover(`${IMPORTS}
declare const ctx: OperationHookContext<Item, "query.find">;
const skip = ctx.skip;
//    ^?`).toBe("const skip: (result: readonly { name: string; _id: ObjectId; }[]) => void");
  });

  test("skip(result) of a count hook takes a number", () => {
    expectHover(`${IMPORTS}
declare const ctx: OperationHookContext<Item, "query.countDocuments">;
const skip = ctx.skip;
//    ^?`).toBe("const skip: (result: number) => void");
  });

  test("a wrong skip result is a readable error", () => {
    expectTypeError(`${IMPORTS}
declare const ctx: OperationHookContext<Item, "query.countDocuments">;
ctx.skip("many");`).toContain("Argument of type 'string' is not assignable to parameter of type 'number'");
  });
});

describe("hover: plugins, policies, documents", () => {
  test("model.statics(plugin) shows the statics without their this", () => {
    expectHover(`${IMPORTS}
const tools: SchemaPlugin<undefined, { byName(this: Model<object>, name: string): Promise<number> }> = {
  name: "tools", apply: () => undefined,
  statics: { byName(this: Model<object>, name: string) { void name; return Promise.resolve(0); } },
};
declare const Items: Model<Item>;
const byName = Items.statics(tools).byName;
//    ^?`).toBe("const byName: (name: string) => Promise<number>");
  });

  test("$updateOne returns the update result typed by the entity's _id", () => {
    expectHover(`${IMPORTS}
declare const doc: HydratedDoc<Item>;
const result = doc.$updateOne({ $set: { name: "x" } });
//    ^?`).toBe("const result: Promise<UpdateResult<ObjectId>>");
  });

  test("the declared discriminator key is the literal in the lean type", () => {
    expectHover(`${IMPORTS}
@Schema({ collection: "shapes" }) class Shape extends Entity {}
@Discriminator("circle") class Circle extends Shape { declare readonly __t: DiscriminatorValue<"circle">; }
declare const c: Lean<Circle>;
const key = c.__t;
//    ^?`).toBe('const key: "circle"');
  });

  test("a wrong literal is a readable error", () => {
    expectTypeError(`${IMPORTS}
@Schema({ collection: "shapes2" }) class Shape extends Entity {}
@Discriminator("circle") class Circle extends Shape { declare readonly __t: DiscriminatorValue<"square">; }`).toContain(
      '@Discriminator: the class declares __t as \\"square\\", but the value is \\"circle\\"',
    );
  });
});
