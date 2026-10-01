/* The types of the subscriber options (wrap, steps, includeTenant) and of the event fields. */
import { expectTypeOf } from "expect-type";
import type {
  InstrumentationSubscriber,
  OperationInfo,
  OperationStartEvent,
  OperationSummary,
} from "../../../src/index.ts";

type Wrap = NonNullable<InstrumentationSubscriber["wrap"]>;
expectTypeOf<Parameters<Wrap>[0]>().toEqualTypeOf<OperationInfo>();
expectTypeOf<Parameters<Wrap>[1]>().toEqualTypeOf<() => Promise<void>>();
expectTypeOf<ReturnType<Wrap>>().toEqualTypeOf<Promise<unknown>>();
expectTypeOf<InstrumentationSubscriber["steps"]>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<InstrumentationSubscriber["includeTenant"]>().toEqualTypeOf<boolean | undefined>();

// The tenant is optional (only for includeTenant subscribers) and unknown (a string, an ObjectId, …).
expectTypeOf<OperationInfo["tenant"]>().toEqualTypeOf<unknown>();
expectTypeOf<OperationInfo["serverAddress"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<OperationInfo["serverPort"]>().toEqualTypeOf<number | undefined>();
expectTypeOf<OperationInfo["populatePath"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<OperationStartEvent["summary"]>().toEqualTypeOf<OperationSummary>();

// An OpenTelemetry-like wrap: `context.with(ctx, run)` returns what `run` returns.
const withContext = <R>(fn: () => R): R => fn();
export const otelLike: InstrumentationSubscriber = {
  handle: () => {},
  steps: false,
  wrap: (_operation, run) => withContext(run),
};

export const wrong: InstrumentationSubscriber = {
  handle: () => {},
  // @ts-expect-error — wrap must return a Promise (run is async), not void
  wrap: (_operation, run) => {
    void run();
  },
};

// @ts-expect-error — includeTenant is a boolean, not the tenant
export const tenantValue: InstrumentationSubscriber = { handle: () => {}, includeTenant: "t1" };
