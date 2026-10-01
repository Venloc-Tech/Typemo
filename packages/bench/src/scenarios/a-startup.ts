import path from "node:path";
import { type Defaulted, Entity, Index, Prop, Schema, Types } from "@venloc/typemo";
/* Bench-only: the schema compiler is internal to Typemo; the bench measures it directly. */
import { SchemaCompiler } from "../../../typemo/src/internal.ts";
import type { ContestantOps } from "../adapters/ops.ts";
import { MEDIUM, type ShapeDef } from "../data/shapes/index.ts";
import { OpScenario } from "../harness/op-scenario.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/*
 * Group A: startup costs — schema definition and compilation, model registration, cold process start and
 * `syncIndexes` on an already synchronized collection.
 */

/** Profiles that run the heavier scenarios. */
const STANDARD: readonly ProfileName[] = ["standard", "full"];

/**
 * A fresh copy of the medium entity (decorators run again, nothing cached): what Typemo does per model at startup.
 * The same fields and options as `MediumDoc`.
 */
class TypemoFactory {
  /**
   * Declares a new medium entity class.
   *
   * @param collection - The collection name.
   * @returns The decorated entity class.
   */
  static medium(collection: string) {
    @Schema({ nested: true })
    class Author {
      @Prop(() => String, { required: true }) first!: string;
      @Prop(() => String) last?: string;
      @Prop(() => String) email?: string;
    }
    @Schema({ nested: true })
    class Geo {
      @Prop(() => Number, { required: true, min: -90, max: 90 }) lat!: number;
      @Prop(() => Number, { required: true, min: -180, max: 180 }) lng!: number;
    }
    @Schema({ nested: true })
    class Address {
      @Prop(() => String) street?: string;
      @Prop(() => String, { required: true }) city!: string;
      @Prop(() => String) zip?: string;
      @Prop(() => String) country?: string;
      @Prop(() => Geo) geo?: Geo;
    }
    @Schema({ nested: true })
    class Stats {
      @Prop(() => Number, { min: 0 }) likes?: number;
      @Prop(() => Number, { min: 0 }) shares?: number;
      @Prop(() => Number, { min: 0 }) comments?: number;
    }
    @Schema({ nested: true })
    class Flags {
      @Prop(() => Boolean) featured?: boolean;
      @Prop(() => Boolean) pinned?: boolean;
    }
    @Index({ status: 1, priority: -1 })
    @Schema({ collection })
    class Medium extends Entity {
      @Prop(() => String, { required: true, maxLength: 200 }) title!: string;
      @Prop(() => String, { required: true, unique: true }) slug!: string;
      @Prop(() => String, { required: true, enum: ["draft", "published", "archived"] }) status!:
        | "draft"
        | "published"
        | "archived";
      @Prop(() => Number, { required: true, min: 0, max: 10 }) priority!: number;
      @Prop(() => [String]) tags!: string[];
      @Prop(() => Number, { default: 0, min: 0 }) views!: Defaulted<number>;
      @Prop(() => Number, { min: 0, max: 5 }) rating?: number;
      @Prop(() => Boolean, { required: true }) published!: boolean;
      @Prop(() => Date) publishedAt?: Date;
      @Prop(() => Author, { required: true }) author!: Author;
      @Prop(() => Address) address?: Address;
      @Prop(() => Stats) stats?: Stats;
      @Prop(() => Flags) flags?: Flags;
      @Prop(() => String) notes?: string;
      @Prop(() => String) category?: string;
      @Prop(() => String, { default: "en" }) language!: Defaulted<string>;
      @Prop(() => Number) revision?: number;
      @Prop(() => Types.ObjectId) sourceId?: Types.ObjectId;
    }
    return Medium;
  }
}

/** Schema definition + compilation: Typemo decorators + SchemaCompiler against `new mongoose.Schema`. */
class SchemaCompile extends Scenario {
  readonly id = "A.schema.compile";
  readonly group = "A" as const;
  readonly title = "определение и компиляция схемы medium (25 полей, 5 вложенных)";
  readonly profiles: readonly ProfileName[] = ["quick", "standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];
  override readonly notes =
    "Typemo: декораторы нового класса + SchemaCompiler.compile; Mongoose: new Schema(definition).";

  /**
   * Builds a contestant that defines and compiles a schema on every run.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    return ScenarioKit.pick(
      {
        mongoose: () =>
          ScenarioKit.impl({
            run: () => MEDIUM.spec.mongooseSchema(env.ctx.mongoose.instance),
            verify: (schema) => Outcomes.value(schema.indexes().length),
          }),
        typemo: () =>
          ScenarioKit.impl({
            run: (i) => SchemaCompiler.compile(TypemoFactory.medium(`bench_compile_${i}`)),
            verify: (schema) => Outcomes.value(schema.indexes.length),
          }),
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** Schema + model registration on a connection (no I/O): what every model costs at application start. */
class ModelDefine extends Scenario {
  readonly id = "A.model.define";
  readonly group = "A" as const;
  readonly title = "схема + регистрация модели на соединении (medium)";
  readonly profiles = STANDARD;
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];

  /**
   * Builds a contestant that registers a fresh model on every run.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    return ScenarioKit.pick(
      {
        mongoose: () => {
          const m = env.ctx.mongoose;
          return ScenarioKit.impl({
            run: (i) => {
              const name = `BenchDefine${i}`;
              const model = m.connection.model(name, MEDIUM.spec.mongooseSchema(m.instance), "bench_define");
              m.connection.deleteModel(name);
              return model;
            },
            verify: (model) => Outcomes.value(typeof model.find === "function"),
          });
        },
        typemo: () => {
          const t = env.ctx.typemo;
          return ScenarioKit.impl({
            run: (i) => t.connection.model(TypemoFactory.medium(`bench_define_${i}`)),
            verify: (model) => Outcomes.value(typeof model.find === "function"),
          });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** Process start → import → model → connect → first query → exit, in a fresh `bun` process. */
class ColdStart extends Scenario {
  readonly id = "A.startup.cold";
  readonly group = "A" as const;
  readonly title = "холодный старт процесса: import + модель + connect + первый findOne";
  readonly profiles = STANDARD;
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo"];
  override readonly iterations = { warmup: 1, maxSamples: 8, maxTimeMs: 2_000 };
  override readonly notes = "Время всего дочернего процесса Bun (старт Bun одинаков у всех).";

  /**
   * Seeds the flat dataset the child processes read.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    const { FLAT } = await import("../data/shapes/flat.ts");
    await env.datasets.ensure(FLAT, "S");
  }

  /**
   * Builds a contestant that spawns a child process per run.
   *
   * @param contestant - Who runs.
   * @returns The implementation.
   */
  build(contestant: ContestantId): ContestantImpl<unknown> {
    const script = path.resolve(import.meta.dir, "../cli/cold-start.ts");
    const cwd = path.resolve(import.meta.dir, "../..");
    return ScenarioKit.impl({
      run: async () => {
        const proc = Bun.spawn([process.execPath, "run", script, contestant], {
          cwd,
          stdout: "ignore",
          stderr: "pipe",
          env: process.env,
        });
        const code = await proc.exited;
        if (code !== 0)
          throw new Error(`cold start exited ${code}: ${(await new Response(proc.stderr).text()).slice(-300)}`);
        return code;
      },
      verify: (code) => Outcomes.value(code),
    });
  }
}

/** `syncIndexes` when the indexes are already in sync (the common startup case): list + diff, nothing to build. */
class SyncIndexes extends OpScenario<object> {
  readonly id = "A.syncIndexes";
  readonly group = "A" as const;
  readonly title = "syncIndexes без изменений (medium: 3 индекса)";
  readonly profiles = STANDARD;
  override readonly scope = "write" as const;
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo"];
  override readonly sizes: readonly SizeName[] = ["S"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Brings the indexes in sync in the way each contestant's user would.
   *
   * @param ops - The contestant's operations.
   * @returns The sync result.
   */
  async op(ops: ContestantOps): Promise<unknown> {
    switch (ops.kind) {
      case "driver": {
        /* What a driver user writes: create the declared indexes (a no-op on the server when they exist). */
        return ops.driver.createIndexes(
          MEDIUM.spec.indexes.map((index) => ({ key: { ...index.keys }, ...(index.options ?? {}) })),
        );
      }
      case "mongoose":
        return ops.mongoose.syncIndexes();
      case "typemo":
        return ops.typemo.syncIndexes();
    }
  }
  /**
   * Fingerprints the collection's indexes.
   *
   * @param _r - Unused.
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   * @returns The outcome over index names, keys and uniqueness.
   */
  override async outcome(_r: unknown, ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<Outcome> {
    const indexes = await this.ctxOf(env).dbOf(ops.contestant).collection(this.def.collection).listIndexes().toArray();
    return Outcomes.value(
      indexes
        .map((ix) => ({ name: ix.name, key: ix.key, unique: ix.unique === true }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      indexes.length,
    );
  }
}

/** The scenarios of group A. */
export const SCENARIOS: readonly Scenario[] = [
  new SchemaCompile(),
  new ModelDefine(),
  new ColdStart(),
  new SyncIndexes(),
];
