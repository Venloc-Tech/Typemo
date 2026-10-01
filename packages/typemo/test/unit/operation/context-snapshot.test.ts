/*
 * When a pre hook changes the operation, the value steps run again from the WHOLE state before them — every
 * working value, `locals` and the rejected documents — not from a hand-kept list of what some step derived. Two
 * guards keep that true for the steps and policies of the future:
 * - a TYPE check: every mutable field of `OperationContext` is either a working value the snapshot restores
 *   (`OperationContext.VALUE_FIELDS`) or listed below as a field the value steps never write. A new field fails
 *   to compile until someone decides which it is;
 * - runtime: `snapshotValues` / `restoreValues` put back exactly the state at `beginValues`, whatever the steps
 *   added.
 * The server-side twin (a conditional local of a value step, the same state as an operation built without a hook)
 * is in `test/runtime/mechanisms/hook-modify.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { expectTypeOf } from "expect-type";
import {
  InstrumentationHub,
  OperationContext,
  type OperationEnvironment,
  SchemaCompiler,
  StrictModeError,
} from "../../../src/internal.ts";
import type { DerivedFlags, ValueField } from "../../../src/operation/pipeline/operation-context.ts";
import type { FindPlan } from "../../../src/query/plan.ts";
import { Person } from "../../fixtures/model/model-entities.ts";

/** `A` when `X` and `Y` are identical types, `B` otherwise. */
type IfEquals<X, Y, A, B> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? A : B;
/** The keys of `T` that are writable data fields (no methods, no getters, no `readonly`). */
type MutableKeys<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown
    ? never
    : IfEquals<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }, K, never>;
}[keyof T];

/**
 * The mutable fields of the context the value steps (normalize → validate) never write: set before them
 * (`resolveContext`), after them (`execute`, `postProcess`, the error path), or by the hooks runtime.
 */
type NotValueFields =
  | "session"
  | "timeoutMS"
  | "options"
  | "policy"
  | "result"
  | "error"
  | "failedStep"
  | "documentCount"
  | "postDone"
  | "runner"
  | "hooks"
  | "skipped"
  | "instrumentStarted"
  | "heldSteps";

describe("the snapshot of a hook's change covers every field the value steps write", () => {
  test("type: each mutable field of OperationContext is a restored working value or a field no value step writes", () => {
    expectTypeOf<MutableKeys<OperationContext>>().toEqualTypeOf<ValueField | keyof DerivedFlags | NotValueFields>();
    expectTypeOf<(typeof OperationContext.VALUE_FIELDS)[number]>().toEqualTypeOf<ValueField>();
    expect(new Set(OperationContext.VALUE_FIELDS).size).toBe(OperationContext.VALUE_FIELDS.length);
  });

  const environment: OperationEnvironment = {
    ready: () => undefined,
    driver: {} as OperationEnvironment["driver"],
    instrumentation: new InstrumentationHub(undefined),
    connectionName: "unit",
    owner: {},
    linksDriverCommands: () => false,
    validateReads: false,
    schemaOfCollection: () => undefined,
  };
  const plan: FindPlan = Object.freeze({
    op: "find",
    entity: Person,
    options: Object.freeze({}),
    filter: Object.freeze({ name: "Ann" }),
    populate: [],
    lean: false,
    orFail: false,
    mode: { kind: "run" } as const,
  });
  const context = (): OperationContext =>
    new OperationContext({
      plan,
      mode: "run",
      target: { entity: Person, schema: SchemaCompiler.compileModel(Person), collection: "m_people", database: "unit" },
      environment,
    });

  test("runtime: restore puts back the plan's values, the locals before the steps (in order) and no rejection", () => {
    const ctx = context();
    const early = Symbol("early");
    const late = Symbol("late");
    ctx.locals.set(early, 1);
    ctx.beginValues();
    /* What value steps do: new working values, new locals, a rejected document. */
    ctx.filter = { n: "Ann" };
    ctx.projection = { n: 1 };
    ctx.locals.set(late, 2);
    ctx.reject(0, new StrictModeError("sanitize", "x", {}));
    const snapshot = ctx.snapshotValues();
    ctx.restoreValues(snapshot);
    expect(ctx.filter).toBe(plan.filter);
    expect(ctx.projection).toBeUndefined();
    expect([...ctx.locals]).toEqual([[early, 1]]);
    expect(ctx.rejected).toEqual([]);
    /* The same snapshot again after another run of the steps (a second change of a later hook). */
    ctx.locals.set(late, 3);
    ctx.restoreValues(snapshot);
    expect([...ctx.locals]).toEqual([[early, 1]]);
  });

  test("runtime: no snapshot before the value steps started (an internal error, never a silent empty state)", () => {
    expect(() => context().snapshotValues()).toThrow(/value steps of this operation have not started/);
  });
});
