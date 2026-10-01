import { describe, expect, test } from "bun:test";
import {
  Entity,
  Index,
  MetadataBuilder,
  MetadataStore,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
  StandardSchema,
} from "../../../src/internal.ts";
import { Person } from "../../fixtures/schema-entities.ts";

/* User input is never mutated (tested on frozen inputs; Mongoose mutated it). */

/** Freezes `value` and everything reachable from it. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

describe("frozen inputs", () => {
  test("decorator and builder options", () => {
    const options = deepFreeze({ required: true, enum: ["a", "b"] as const });
    const indexOptions = deepFreeze({
      unique: true as const,
      partialFilterExpression: { $or: [{ code: { $exists: true as const } }] },
    });
    @Index({ code: 1 }, indexOptions)
    @Schema(deepFreeze({ collection: "frozen" }))
    class Frozen extends Entity {
      @Prop(() => String, options) code!: "a" | "b";
    }
    expect(() => SchemaCompiler.compile(Frozen)).not.toThrow();
    expect(MetadataStore.own(Frozen).fields[0]?.options).toEqual({ required: true, enum: ["a", "b"] });
    class Direct {}
    expect(() => MetadataBuilder.for(Direct).addField("x", () => String, deepFreeze({ default: "x" }))).not.toThrow();
  });

  test("documents given to cast, validate and encode", async () => {
    const schema = SchemaCompiler.compile(Person);
    const input = deepFreeze({
      name: { first: "  Ann " },
      email: "A@B.C",
      tags: ["x"],
      addresses: [{ city: "Oslo", zip: null }],
      scores: { math: 5 },
      shapes: [{ kind: "circle", radius: 1 }],
    });
    const cast = SchemaWalker.castDocument(schema, input);
    expect(cast.email).toBe("a@b.c");
    expect(cast.tags).not.toBe(input.tags);
    expect((cast.addresses as unknown[])[0]).not.toBe(input.addresses[0]);
    const validated = await StandardSchema.of(schema)["~standard"].validate(input);
    expect(validated.issues).toBeUndefined();
    const frozenCast = deepFreeze(cast);
    expect(() => SchemaWalker.encodeDocument(schema, frozenCast)).not.toThrow();
    expect(input.name.first).toBe("  Ann ");
  });
});
