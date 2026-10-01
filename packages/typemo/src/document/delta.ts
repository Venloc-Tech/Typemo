import { QueryError } from "../errors/query-error.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { ChangeTracker } from "./change-tracker.ts";
import { Collections } from "./collections/collections.ts";
import { DirectWriteError } from "./collections/direct-write-error.ts";
import { HydrationPlan } from "./collections/hydration-plan.ts";
import type { FoundUnknown } from "./collections/tracked-protocol.ts";
import { UnknownFieldsError } from "./collections/unknown-fields-error.ts";
import { UpdateOps, type UpdateParts, type VersionImpact } from "./collections/update-ops.ts";
import { type DocumentState, DocumentStates } from "./document-state.ts";
import { PopulatedFields } from "./populated-fields.ts";

/**
 * What a save would send for the fields (before versioning and timestamps).
 *
 * @example
 * ```ts
 * const delta: DocumentDelta = Delta.build(user);
 * delta.parts.$set; // { name: "Ada" }
 * ```
 */
export interface DocumentDelta {
  /** The update in code names, plain values (`Map`s as `Map`). */
  readonly parts: UpdateParts;
  /** The strongest version impact of the changes. */
  readonly version: VersionImpact;
  /** The code paths changed. */
  readonly modifiedPaths: readonly string[];
  /** Stored subdocuments with unknown fields this update rewrites or replaces (accepted by `dropUnknownFields`). */
  readonly unknown: readonly FoundUnknown[];
}

/**
 * Options of `Delta.build`.
 *
 * @example
 * ```ts
 * const options: DeltaOptions = { dropUnknownFields: true };
 * ```
 */
export interface DeltaOptions {
  /** Accept that stored fields unknown to the schema are lost (otherwise `UnknownFieldsError`). */
  readonly dropUnknownFields?: boolean;
  /**
   * Preview mode (`$getChanges`): instead of throwing, every refusal the save would raise is recorded here as
   * code path → the message of that error, and the delta is built from what can still be sent.
   */
  readonly problems?: Map<string, string>;
}

/**
 * A document as a bag of fields.
 *
 * @example
 * ```ts
 * const doc: Doc = { name: "Ada" };
 * ```
 */
type Doc = Record<string, unknown>;

/** The order of version impacts, from the weakest. */
const RANK: Readonly<Record<VersionImpact, number>> = { none: 0, where: 1, increment: 2 };

/**
 * The stronger of two version impacts.
 *
 * @param a - The first impact.
 * @param b - The second impact.
 * @returns The one that ranks higher.
 */
const stronger = (a: VersionImpact, b: VersionImpact): VersionImpact => (RANK[b] > RANK[a] ? b : a);

/**
 * Whether a field is one a save never writes as user data: the core maintains it.
 *
 * @param node - The field node.
 * @returns `true` for the version field.
 */
const isCoreField = (node: PathNode): boolean => node.service === "version";

/**
 * The minimal update of a save: a PURE function of the document (Mongoose's `$__delta` changed the document
 * and could throw halfway). Root fields: `$set` of a changed value, `$unset` of a removed one. Containers
 * and subdocuments: their journals (`$push`/`$addToSet`/`$pullAll`/`$pull`/`$pop`, `$set` of an element or
 * of the whole array; conflicting operators on one array become one `$set` of the array). The parts of all
 * fields are merged by `UpdateOps.merge`: two fields never touch the same path, a clash is an internal error.
 *
 * A forced path (`$markModified`) is sent as `$set` of its WHOLE top-level field, because a narrower `$set`
 * next to the field's own journal could clash on a prefix.
 */
export class Delta {
  /**
   * The plain value of a field (containers as plain data, `Map`s kept).
   *
   * @param value - The field value.
   * @returns The plain value.
   */
  static plain(value: unknown): unknown {
    return Collections.toPlain(value, { maps: "map" });
  }

  /**
   * The delta of `document`.
   *
   * @param document - The hydrated root document.
   * @param options - Delta options.
   * @returns What the save would send.
   * The errors below are thrown only without `options.problems`; with it they are recorded there instead.
   * @throws {DirectWriteError} When a container was replaced around `$set`.
   * @throws {PartialArrayError} When a partially loaded array would be overwritten.
   * @throws {QueryError} When the version field was written by hand.
   * @throws {UnknownFieldsError} When stored fields unknown to the schema would be lost and
   * `dropUnknownFields` is not set.
   */
  static build(document: object, options: DeltaOptions = {}): DocumentDelta {
    const state = DocumentStates.of(document);
    const doc = document as Doc;
    const parts: UpdateParts[] = [];
    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    const modified: string[] = [];
    let version: VersionImpact = "none";
    const unknown: FoundUnknown[] = [];
    const forced = Delta.forcedKeys(state);
    const problems = options.problems;
    /* In preview mode a refusal marks its path and the rest of the delta is still built; otherwise it throws. */
    const refuse = (path: string, error: Error): void => {
      if (problems === undefined) throw error;
      problems.set(path, error.message);
    };
    for (const field of state.plan.fields) {
      const node = field.node;
      /* The stored value of a populated field (its ids), never the populated documents. */
      const value = PopulatedFields.stored(document, node.key, doc[node.key]);
      const change = ChangeTracker.fieldChange(document, state, node, field.index);
      if (isCoreField(node) && change !== "none") {
        refuse(
          node.key,
          new QueryError(
            `${state.schema.name}.${node.key} is the version key: the core maintains it; it cannot be changed by hand`,
            { path: node.key },
          ),
        );
        continue;
      }
      if (forced.has(node.key) && value !== undefined) {
        if (HydrationPlan.isContainer(node)) unknown.push(...Collections.unknownIn(value, node.key));
        set[node.key] = Delta.plain(value);
        modified.push(node.key);
        if (node.kind === "array") version = stronger(version, "increment");
        continue;
      }
      switch (change) {
        case "none":
          break;
        case "unset":
          unset[node.key] = "";
          modified.push(node.key);
          if (node.kind === "array") version = stronger(version, "increment");
          break;
        case "replaced":
          refuse(
            node.key,
            new DirectWriteError(
              node.key,
              `the field was replaced by assignment; use $set("${node.key}", value) or the container's methods`,
            ),
          );
          break;
        case "set":
          if (HydrationPlan.isContainer(node)) {
            /* The stored value is replaced as a whole; the new one is written as a whole. */
            const previous = state.baseline.get(node.key);
            if (previous !== value) unknown.push(...Collections.unknownIn(previous, node.key));
            unknown.push(...Collections.unknownIn(value, node.key));
          }
          set[node.key] = value === null ? null : Delta.plain(value);
          modified.push(node.key);
          /* A whole array rewritten: its positions and length change (Mongoose VERSION_ALL). */
          if (node.kind === "array") version = stronger(version, "increment");
          break;
        case "child": {
          let delta: ReturnType<typeof Collections.toUpdateOps>;
          try {
            delta = Collections.toUpdateOps(
              value,
              "code",
              { code: node.key, db: node.dbKey },
              { unknownFields: "report" },
            );
          } catch (error) {
            if (problems === undefined || !(error instanceof Error)) throw error;
            problems.set(node.key, error.message);
            break;
          }
          unknown.push(...delta.unknown);
          parts.push(delta.ops);
          modified.push(...delta.modifiedPaths);
          version = stronger(version, delta.version);
          break;
        }
      }
    }
    if (unknown.length > 0 && options.dropUnknownFields !== true) {
      const error = new UnknownFieldsError(unknown.map((entry) => ({ path: entry.path, keys: entry.keys })));
      if (problems === undefined) throw error;
      for (const entry of unknown) problems.set(entry.path, error.message);
    }
    const own: { $set?: Record<string, unknown>; $unset?: Record<string, ""> } = {};
    if (Object.keys(set).length > 0) own.$set = set;
    if (Object.keys(unset).length > 0) own.$unset = unset;
    return {
      parts: UpdateOps.merge([own as UpdateParts, ...parts]),
      version,
      modifiedPaths: [...new Set(modified)],
      unknown,
    };
  }

  /**
   * Whether the delta sends nothing.
   *
   * @param delta - The delta to test.
   * @returns `true` when it has no operations.
   */
  static isEmpty(delta: DocumentDelta): boolean {
    return UpdateOps.isEmpty(delta.parts);
  }

  /**
   * The top-level keys whose whole value a `$markModified` forces into the update.
   *
   * @param state - The document state.
   * @returns The forced top-level keys.
   */
  private static forcedKeys(state: DocumentState): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const path of state.marked ?? []) keys.add(path.split(".")[0] as string);
    return keys;
  }
}
