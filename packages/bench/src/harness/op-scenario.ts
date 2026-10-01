import type { BenchContext } from "../adapters/bench-context.ts";
import { ContestantOps } from "../adapters/ops.ts";
import { Datasets } from "../data/datasets.ts";
import type { ShapeDef } from "../data/shapes/shape-def.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv } from "./scenario.ts";
import type { ContestantId, Outcome } from "./types.ts";
import { Outcomes } from "./verify.ts";

/** Contestants of write scenarios: `typemo-lean` would run the very same calls as `typemo`. */
export const WRITERS: readonly ContestantId[] = ["driver", "mongoose", "mongoose-safe", "typemo"];

/**
 * A scenario that is one operation on one shape for every contestant, expressed once through ContestantOps.
 * Subclasses implement `op` (timed) and optionally `before` (untimed) and `outcome`.
 */
export abstract class OpScenario<E extends object> extends Scenario {
  /** The shape (schema and data generator) the operation works on. */
  abstract readonly def: ShapeDef<E>;
  /** `ensure`: seed the shape's dataset for the size once (read-only scenarios). */
  readonly seeding: "ensure" | "none" = "ensure";
  /** `write`: work in the scratch databases (BenchContext.writable) — every scenario that mutates data. */
  readonly scope: "read" | "write" = "read";

  /**
   * The connections the scenario works on.
   *
   * @param env - The scenario environment.
   * @returns The scratch connections for a write scenario, otherwise the shared ones.
   */
  ctxOf(env: ScenarioEnv): BenchContext {
    return this.scope === "write" ? env.ctx.writable : env.ctx;
  }

  /**
   * The datasets the scenario works on.
   *
   * @param env - The scenario environment.
   * @returns Datasets over the scratch connections for a write scenario, otherwise the shared ones.
   */
  datasetsOf(env: ScenarioEnv): Datasets {
    return this.scope === "write" ? new Datasets(env.ctx.writable) : env.datasets;
  }

  /**
   * Seeds the dataset when the scenario asks for it.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    if (this.seeding === "ensure") await this.datasetsOf(env).ensure(this.def, env.size);
  }

  /**
   * Documents in the seeded dataset for the size.
   *
   * @param env - The scenario environment.
   * @returns The document count.
   */
  countOf(env: ScenarioEnv): number {
    return this.def.countFor(env.size);
  }

  /**
   * The timed operation.
   *
   * @param ops - The contestant's operations on this shape.
   * @param iteration - Grows across warmup and samples.
   * @param env - The scenario environment.
   * @returns The result, handed to `outcome`.
   */
  abstract op(ops: ContestantOps, iteration: number, env: ScenarioEnv): Promise<unknown>;

  /**
   * Untimed work before every timed `op`.
   *
   * @param ops - The contestant's operations on this shape.
   * @param iteration - The iteration number.
   * @param env - The scenario environment.
   */
  before(ops: ContestantOps, iteration: number, env: ScenarioEnv): Promise<void> | void {
    void ops;
    void iteration;
    void env;
  }

  /**
   * Untimed work once per repeat.
   *
   * @param ops - The contestant's operations on this shape.
   * @param env - The scenario environment.
   */
  setup(ops: ContestantOps, env: ScenarioEnv): Promise<void> | void {
    void ops;
    void env;
  }

  /**
   * Turns the last result into an outcome that is compared across contestants.
   *
   * @param result - What `op` returned last.
   * @param ops - The contestant's operations on this shape.
   * @param iteration - The iteration number.
   * @param env - The scenario environment.
   * @returns The outcome.
   */
  outcome(result: unknown, ops: ContestantOps, iteration: number, env: ScenarioEnv): Promise<Outcome> | Outcome {
    void ops;
    void iteration;
    void env;
    return OpScenario.defaultOutcome(result);
  }

  /**
   * The outcome of an arbitrary result: documents, a number or a single document.
   *
   * @param result - What `op` returned.
   * @returns The outcome.
   */
  static defaultOutcome(result: unknown): Outcome {
    if (Array.isArray(result)) return Outcomes.docs(result);
    if (typeof result === "number") return Outcomes.value(result, result);
    return Outcomes.doc(result);
  }

  /**
   * Builds a contestant's implementation from `setup`, `before`, `op` and `outcome`.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const ops = ContestantOps.of(this.ctxOf(env), contestant, this.def);
    return {
      setup: () => this.setup(ops, env),
      before: (i) => this.before(ops, i, env),
      run: (i) => this.op(ops, i, env),
      verify: (result, i) => this.outcome(result, ops, i, env),
    };
  }
}
