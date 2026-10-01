import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";

/*
 * `replaceOne`/`findOneAndReplace` of a schema with service fields (`createdAt`, `updatedAt`, `__v`). The user does
 * not pass them (the type leaves them out, the resolve step refuses them); the core keeps them ATOMICALLY with an
 * update pipeline instead of a plain replacement:
 *
 *   [{ $replaceWith: { $mergeObjects: [
 *       { $literal: <replacement> },                       // the user's document, as data
 *       { createdAt: { $ifNull: ["$createdAt", now] },     // kept; a new document (upsert) gets now
 *         __v:       { $ifNull: ["$__v", 0] },             // kept; 0 on upsert
 *         updatedAt: now } ] } }]                          // bumped
 *
 * `$literal` keeps the replacement data (a string "$x" or a key "$gt" inside it is a value, not a field path or an
 * operator). The server keeps `_id` (also on upsert, from the filter's equality); verified on MongoDB 9.0.0-rc0 and
 * 8.3 (test/runtime/model/replace-service-fields.test.ts).
 */

/* The service fields a replacement keeps. */
const KEPT = new Set(["createdAt", "version"]);

/** Builds the update pipeline of a replacement, which keeps the service fields. */
export class ReplacementPipeline {
  /**
   * Tells whether the schema has a service field a replacement must keep or bump.
   *
   * @param schema - The compiled schema.
   * @returns `true` when the replacement needs the update pipeline.
   */
  static needed(schema: CompiledSchema): boolean {
    return schema.fields.some(
      (field) => field.service !== undefined && (KEPT.has(field.service) || field.service === "updatedAt"),
    );
  }

  /**
   * The pipeline replacing the stored document with `replacement` (database form), service fields kept.
   *
   * @param schema - The compiled schema.
   * @param replacement - The replacement document in database form.
   * @param now - The operation's clock.
   * @returns The update pipeline.
   */
  static of(schema: CompiledSchema, replacement: PlanDocument, now: Date): readonly PipelineStage[] {
    const service: Record<string, unknown> = {};
    for (const field of schema.fields) {
      switch (field.service) {
        case "createdAt":
          service[field.dbKey] = { $ifNull: [`$${field.dbKey}`, new Date(now.getTime())] };
          break;
        case "version":
          service[field.dbKey] = { $ifNull: [`$${field.dbKey}`, 0] };
          break;
        case "updatedAt":
          service[field.dbKey] = new Date(now.getTime());
          break;
        default:
          break;
      }
    }
    return Object.freeze([
      Object.freeze({ $replaceWith: { $mergeObjects: [{ $literal: { ...replacement } }, service] } }),
    ]);
  }
}
