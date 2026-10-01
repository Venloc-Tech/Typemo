import { AuditStep } from "../../policies/audit-policy.ts";
import { PopulateStep } from "../../populate/populate-step.ts";
import { CastStep } from "../steps/cast-step.ts";
import { DefaultsStep } from "../steps/defaults-step.ts";
import { NormalizeStep } from "../steps/normalize-step.ts";
import { PolicyStep } from "../steps/policy-step.ts";
import { ResolvePathsStep } from "../steps/resolve-paths-step.ts";
import { ValidateStep } from "../steps/validate-step.ts";
import { OperationPipeline } from "./operation-pipeline.ts";
import { ExecuteStep } from "./steps/execute-step.ts";
import { HooksPostStep } from "./steps/hooks-post-step.ts";
import { HooksPreStep } from "./steps/hooks-pre-step.ts";
import { InstrumentEndStep } from "./steps/instrument-end-step.ts";
import { InstrumentStartStep } from "./steps/instrument-start-step.ts";
import { PostProcessStep } from "./steps/post-process-step.ts";
import { ResolveContextStep } from "./steps/resolve-context-step.ts";
import { ValidateOptionsStep } from "./steps/validate-options-step.ts";

/**
 * The pipeline every connection starts with: the spine (context, options, hooks, instrumentation, the driver call,
 * results) and the value steps (normalize to validate: policies, casting, dbName, defaults/timestamps/version,
 * validation; `ValidateStep` ends by encoding the values to the database form), `populate`, and `audit` (the audit
 * policy, off unless the schema enables it).
 *
 * @example
 * ```ts
 * const pipeline = StandardPipeline.create();
 * ```
 */
export class StandardPipeline {
  /**
   * Builds the standard pipeline with every slot filled.
   *
   * @returns A new pipeline.
   */
  static create(): OperationPipeline {
    return new OperationPipeline({
      resolveContext: new ResolveContextStep(),
      validateOptions: new ValidateOptionsStep(),
      normalize: new NormalizeStep(),
      resolvePaths: new ResolvePathsStep(),
      cast: new CastStep(),
      policies: new PolicyStep(),
      defaults: new DefaultsStep(),
      validate: new ValidateStep(),
      hooksPre: new HooksPreStep(),
      instrumentStart: new InstrumentStartStep(),
      execute: new ExecuteStep(),
      postProcess: new PostProcessStep(),
      populate: new PopulateStep(),
      audit: new AuditStep(),
      hooksPost: new HooksPostStep(),
      instrumentEnd: new InstrumentEndStep(),
    });
  }
}
