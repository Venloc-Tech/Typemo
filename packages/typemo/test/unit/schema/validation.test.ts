import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  CastError,
  type Defaulted,
  Entity,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
  StandardSchema,
  type StandardSchemaV1,
  ValidationError,
} from "../../../src/internal.ts";
import { Person } from "../../fixtures/schema-entities.ts";

/* Validators of the option catalog and the Standard Schema adapter. */

enum Level {
  Low = 1,
  High = 2,
}

@Schema()
class Checked extends Entity {
  @Prop(() => String, { required: true, minLength: 2, maxLength: 5, match: /^[a-z]+$/ })
  code!: string;

  @Prop(() => Number, { min: 1, max: 10 })
  count?: number;

  @Prop(() => Number, { enum: Level })
  level?: Level;

  @Prop(() => Date, { min: new Date("2020-01-01T00:00:00Z") })
  since?: Date;

  @Prop(() => BigInt, { max: 10n })
  big?: bigint;

  @Prop(() => String, { validate: [(v) => v !== "bad" || "no bad", (v) => v.length < 10 || "too long"] })
  note?: string;

  @Prop(() => String, { validate: async (v) => (await Promise.resolve(v !== "slow")) || "async says no" })
  remote?: string;

  @Prop(() => [String], { enum: ["a", "b"], validate: (v) => v.length <= 2 || "at most two" })
  letters?: ("a" | "b")[];

  @Prop(() => String, { nullable: true, required: true })
  maybe!: string | null;

  @Prop(() => Number, { default: () => 7 })
  seven!: Defaulted<number>;
}

const standard = (): StandardSchemaV1 => StandardSchema.of(SchemaCompiler.compile(Checked));
const validate = async (input: unknown) => standard()["~standard"].validate(input);
const issuesOf = async (input: unknown) =>
  ((await validate(input)).issues ?? []).map((issue) => [issue.path?.join("."), issue.message]);

describe("built-in validators", () => {
  test("a valid input: the cast value with defaults (and the generated _id)", async () => {
    const result = await validate({ code: "abc", maybe: "x", level: 2 });
    expect(result.issues).toBeUndefined();
    const value = (result as { value: Record<string, unknown> }).value;
    expect(value).toMatchObject({ code: "abc", maybe: "x", level: 2, seven: 7 });
    expect(value._id).toBeInstanceOf(ObjectId);
  });

  test("every issue is reported, not only the first", async () => {
    expect(
      await issuesOf({
        code: "A",
        count: 11,
        level: 3,
        since: new Date("2019-01-01T00:00:00Z"),
        big: 11n,
        note: "bad",
        letters: ["a", "c", "b"],
        maybe: null,
        extra: true,
      }),
    ).toEqual([
      ["extra", "not a field of Checked"],
      ["code", "must be at least 2 characters long"],
      ["code", "must match /^[a-z]+$/"],
      ["count", "must be at most 10"],
      ["level", "must be one of 1, 2"],
      ["since", "must be at least 2020-01-01T00:00:00.000Z"],
      ["big", "must be at most 10n"],
      ["note", "no bad"],
      ["letters.1", 'must be one of "a", "b"'],
      ["letters", "at most two"],
    ]);
  });

  test("required + nullable: the key is required, null is a value", async () => {
    expect(await issuesOf({ code: "abc", maybe: null })).toEqual([]);
    expect(await issuesOf({ code: "abc" })).toEqual([["maybe", "the field is required"]]);
  });

  test("required: absent is an issue; defaults fill before required is checked", async () => {
    expect(await issuesOf({})).toEqual([
      ["code", "the field is required"],
      ["maybe", "the field is required"],
    ]);
  });

  test("async validators make the result a Promise", async () => {
    const pending = standard()["~standard"].validate({ code: "abc", maybe: "x", remote: "slow" });
    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).issues?.map((issue) => issue.message)).toEqual(["async says no"]);
    expect(standard()["~standard"].validate({ code: "abc", maybe: "x" })).not.toBeInstanceOf(Promise);
  });

  test("cast problems are issues with the CastError message", async () => {
    expect(await issuesOf({ code: 5, maybe: "x", count: "3" })).toEqual([
      ["code", 'Cast to string failed at path "code" for 5 (number): expected a string [type]'],
      ["count", 'Cast to number failed at path "count" for "3" (string): expected a number [type]'],
    ]);
  });

  test("a validator that throws is an issue with the error as cause", async () => {
    @Schema()
    class Throwing extends Entity {
      @Prop(() => String, {
        validate: () => {
          throw new Error("kaput");
        },
      })
      value?: string;
    }
    const result = SchemaWalker.validateDocument(
      SchemaCompiler.compile(Throwing),
      { value: "x" },
      { validate: true, defaults: true },
    );
    expect(result.issues.map((issue) => [issue.reason, issue.message])).toEqual([
      ["validator", "the validator threw: kaput"],
    ]);
  });

  test("Standard Schema metadata: version 1, vendor typemo, issue paths as segments", async () => {
    const props = standard()["~standard"];
    expect(props.version).toBe(1);
    expect(props.vendor).toBe("typemo");
    const nested = await StandardSchema.of(SchemaCompiler.compile(Person))["~standard"].validate({
      name: { first: "A" },
      addresses: [{ city: "x" }, { city: 5 }],
    });
    expect(nested.issues?.[0]?.path).toEqual(["addresses", 1, "city"]);
  });
});

describe("ValidationError", () => {
  test("lists every issue in the message; toJSON leaves the values out", () => {
    const result = SchemaWalker.validateDocument(
      SchemaCompiler.compile(Checked),
      { code: "A", secret: "p4ss" },
      { validate: true, defaults: true },
    );
    const error = new ValidationError(result.issues);
    expect(error.name).toBe("ValidationError");
    expect(error.message).toBe(
      'Validation failed: "secret": not a field of Checked [unknown-key]; "code": must be at least 2 characters long [minLength]; "code": must match /^[a-z]+$/ [match]; "maybe": the field is required [required]',
    );
    expect(JSON.stringify(error)).not.toContain("p4ss");
    expect(Object.keys(error)).toEqual(["issues"]);
  });

  test("casting (not validating) throws the first CastError", () => {
    expect(() => SchemaWalker.castDocument(SchemaCompiler.compile(Checked), { code: 1 })).toThrow(CastError);
  });
});
