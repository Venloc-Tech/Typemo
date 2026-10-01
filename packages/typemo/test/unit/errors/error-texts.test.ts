import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { ConfigurationError } from "../../../src/errors/configuration-error.ts";
import { ErrorTranslator } from "../../../src/errors/error-translator.ts";
import { QueryError } from "../../../src/errors/query-error.ts";
import type { ServerError } from "../../../src/errors/server-error.ts";
import type { Defaulted } from "../../../src/index.ts";
import { ModelOperations, Prop, Schema, SchemaCompiler } from "../../../src/internal.ts";
import { Account } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/* Error texts name the offending path once, and print values with their type. */

const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);
const id = new ObjectId();
/** Hands `value` to the builders without the static types getting in the way. */
// biome-ignore lint/suspicious/noExplicitAny: the texts are about input beyond the static types.
const loose = (value: unknown): any => value;

/** The message of the error `run` rejects with. */
const messageOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected an error");
};

describe("an unknown path is named once", () => {
  test("filter, nested filter, update, projection, sort and distinct", async () => {
    const full = async (plan: Promise<Parameters<typeof StepHarness.full>[0]>) =>
      messageOf(async () => StepHarness.full(await plan));
    expect(await full(capture.plan(Accounts.find(loose({ nope: 1 }))))).toBe(
      'filter: "nope" is not a field of Account [unknown-path]',
    );
    expect(await full(capture.plan(Accounts.find(loose({ $or: [{ nope: 1 }] }))))).toBe(
      'filter.$or.0: "nope" is not a field of Account [unknown-path]',
    );
    expect(await full(capture.plan(Accounts.updateOne({ _id: id }, loose({ $set: { nope: 1 } }))))).toBe(
      '$set: "nope" is not a field of Account [unknown-path]',
    );
    expect(await full(capture.plan(Accounts.find({}).select(loose({ nope: 1 }))))).toBe(
      'projection: "nope" is not a field of Account [unknown-path]',
    );
    expect(await full(capture.plan(Accounts.find({}).sort(loose({ "name.nope": 1 }))))).toMatch(
      /^sort: "name\.nope": /,
    );
    expect(await full(capture.plan(Accounts.distinct(loose("nope"))))).toBe(
      'distinct: "nope" is not a field of Account [unknown-path]',
    );
  });

  test("a +path of a projection is checked like any projection key, alone or next to others", async () => {
    const full = async (plan: Promise<Parameters<typeof StepHarness.full>[0]>) =>
      messageOf(async () => StepHarness.full(await plan));
    const unknownPlus = 'projection: "nope" is not a field of Account [unknown-path]';
    /* alone: an exclusion projection, where a +path leaves no key of its own */
    expect(await full(capture.plan(Accounts.find({}).select(loose({ "+nope": true }))))).toBe(unknownPlus);
    /* next to an exclusion and next to an inclusion */
    expect(await full(capture.plan(Accounts.find({}).select(loose({ name: 0, "+nope": true }))))).toBe(unknownPlus);
    expect(await full(capture.plan(Accounts.find({}).select(loose({ name: 1, "+nope": true }))))).toBe(unknownPlus);
    expect(await full(capture.plan(Accounts.findOne({}).select(loose({ "+name.nope": true }))))).toMatch(
      /^projection: "name\.nope": .*\[unknown-path\]$/,
    );
    /* a "-path" key is not a form of the projection: it is a key like any other, and unknown */
    expect(await full(capture.plan(Accounts.find({}).select(loose({ "-nope": 0 }))))).toBe(
      'projection: "-nope" is not a field of Account [unknown-path]',
    );
  });

  test("the string forms of select are not accepted: +path and -path in a string are a QueryError", () => {
    /* cast: a string is not a projection for the types; `as never` keeps the builder's result type out of it */
    expect(() => Accounts.find({}).select("+nope" as never)).toThrow(QueryError);
    /* cast: as above, the string form is refused by the types */
    expect(() => Accounts.find({}).select("-nope" as never)).toThrow(QueryError);
  });
});

describe("a schema default error names the field once", () => {
  test('"default: null" on a field that is not nullable', () => {
    @Schema()
    class A10 {
      /* cast: an invalid default passed on purpose to test the schema compiler check */
      @Prop(() => String, { default: null as unknown as Defaulted<string> })
      a!: Defaulted<string>;
    }
    expect(() => SchemaCompiler.compile(A10)).toThrow(ConfigurationError);
    expect(() => SchemaCompiler.compile(A10)).toThrow(/^A10\.a: "default: null" on a field that is not nullable$/);
  });

  test("a default of another type prints the value with its type and the cast detail", () => {
    @Schema()
    class A11 {
      /* cast: an invalid default passed on purpose to test the schema compiler check */
      @Prop(() => Number, { default: "x" as unknown as Defaulted<number> })
      a!: Defaulted<number>;
    }
    expect(() => SchemaCompiler.compile(A11)).toThrow(
      /^A11\.a: the "default" value is not a value of the field \(got "x" \(string\)\): [^"]*\[type\]$/,
    );
  });
});

describe("numeric builder settings take numbers only, and print the value with its type", () => {
  test('limit("3") is refused and the text shows the string', () => {
    expect(() => Accounts.find({}).limit(loose("3"))).toThrow('limit must be a positive integer, got "3" (string)');
    expect(() => Accounts.find({}).skip(loose("3"))).toThrow('skip must be a non-negative integer, got "3" (string)');
    expect(() => Accounts.find({}).timeoutMS(loose("5"))).toThrow(
      'timeoutMS must be a non-negative integer, got "5" (string)',
    );
    expect(() => Accounts.find({}).batchSize(loose("5"))).toThrow(
      'batchSize must be a positive integer, got "5" (string)',
    );
    expect(() => Accounts.find({}).limit(loose(2.5))).toThrow("got 2.5 (number)");
  });

  test("batchSize(0) is refused: the driver reads 0 as the server default", () => {
    expect(() => Accounts.find({}).batchSize(0)).toThrow(/batchSize must be a positive integer, got 0 \(number\)/);
    expect(() => Accounts.find({}).batchSize(-1)).toThrow(QueryError);
    expect(() => Accounts.find({}).batchSize(1)).not.toThrow();
    expect(() => Accounts.find({}).skip(0)).not.toThrow();
    expect(() => Accounts.find({}).timeoutMS(0)).not.toThrow();
  });
});

describe("for await over a query", () => {
  test("is a QueryError that says to iterate .cursor()", async () => {
    const run = async (): Promise<void> => {
      // @ts-expect-error a query is not async-iterable: the compiler refuses it (TS2504), the runtime explains it
      for await (const _ of Accounts.find({})) {
        /* never reached */
      }
    };
    await expect(run()).rejects.toThrow(QueryError);
    await expect(run()).rejects.toThrow(/\.cursor\(\)/);
  });
});

describe("an empty update pipeline", () => {
  test("is a QueryError, like the other errors of an update", () => {
    expect(() => Accounts.updateOne({ _id: id }, (p) => p as never)).toThrow(QueryError);
    expect(() => Accounts.updateOne({ _id: id }, (p) => p as never)).toThrow(
      "an update pipeline needs at least one stage",
    );
  });
});

describe("ServerError texts", () => {
  const driverError = (fields: Record<string, unknown>, message: string): Error =>
    Object.assign(new Error(message), { name: "MongoServerError", ...fields });

  test("the message is the innermost reason and the code; serverMessage keeps the full text", () => {
    const raw =
      'error processing query: ns=db.c Tree: secret $eq "p4ss"\nSort: {}\n planner returned error :: caused by :: hint provided does not correspond to an existing index';
    const error = ErrorTranslator.wrap(driverError({ code: 2, codeName: "BadValue" }, raw)) as ServerError;
    expect(error.message).toBe("hint provided does not correspond to an existing index (code 2 BadValue)");
    expect(error.serverMessage).toBe(raw);
    expect((error.cause as Error).message).toBe(raw);
    expect(ErrorTranslator.summary("First sentence. Second one.", 9, undefined)).toBe("First sentence. (code 9)");
  });

  test("codeName comes from the table of codes when the server leaves it out", () => {
    const duplicate = ErrorTranslator.wrap(driverError({ code: 11000 }, "E11000 duplicate key error")) as ServerError;
    expect(duplicate.codeName).toBe("DuplicateKey");
    const validation = ErrorTranslator.wrap(driverError({ code: 121 }, "Document failed validation")) as ServerError;
    expect(validation.codeName).toBe("DocumentValidationFailure");
    const unknown = ErrorTranslator.wrap(driverError({ code: 999999 }, "x")) as ServerError;
    expect(unknown.codeName).toBeUndefined();
  });
});

describe("$where and other server-side JavaScript", () => {
  test("the text keeps the CVE reference and says why and what to use instead", async () => {
    const message = await messageOf(async () =>
      StepHarness.full(await capture.plan(Accounts.find(loose({ $where: "this.age > 1" })))),
    );
    expect(message).toContain('"$where" runs JavaScript on the server and is not supported');
    expect(message).toContain("CVE-2025-23061");
    expect(message).toContain("injected input into executed code");
    expect(message).toContain("$expr");
  });
});
