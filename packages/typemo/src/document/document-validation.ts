import { BsonGuards } from "../bson/bson-guards.ts";
import { PathResolver } from "../operation/steps/path-resolver.ts";
import { type ContextOf, IssueCollector, ValueValidator } from "../operation/steps/value-validator.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { DocumentSerializer } from "./document-serializer.ts";
import { type DocumentState, DocumentStates } from "./document-state.ts";

/**
 * One segment of a path: a key, or an array index.
 *
 * @example
 * ```ts
 * const path: Segment[] = ["lines", 0, "qty"];
 * ```
 */
type Segment = string | number;

/** Matches a path segment that is an array index. */
const NUMERIC = /^\d+$/;

/**
 * Validation of root documents: the SAME validators as everywhere (`ValueValidator` of the operation steps:
 * `required`, `enum`, `min`/`max`, `minLength`/`maxLength`, `match`, user validators, sync and async, with a
 * `ValidationContext`), on the document's plain data, every issue collected into ONE `ValidationError`.
 * - `"all"`: every loaded field (a new document, `$validate()`); fields a projection left out are not
 *   checked (their `required` is unknown, not missing);
 * - `"modified"`: the paths the save writes — each changed value with everything inside it, plus the own
 *   validators of the arrays and Maps that contain it (a new element can break an array's validator).
 *
 * The values are cast already: a directly assigned value that cannot be cast is a `CastError` before the
 * validation runs (`ChangeTracker.castAssigned`), so the constraints of such a field are never checked.
 */
export class DocumentValidation {
  /**
   * Validates `document`.
   *
   * @param document - The hydrated root document.
   * @param scope - `all` checks every loaded field, `modified` only the paths in `modifiedPaths`.
   * @param modifiedPaths - The paths the save writes (used by the `modified` scope).
   * @returns Resolves when the document is valid.
   * @throws {ValidationError} With every issue found, in the order of the schema fields.
   */
  static async validate(document: object, scope: "all" | "modified", modifiedPaths: readonly string[]): Promise<void> {
    const state = DocumentStates.of(document);
    const data = DocumentSerializer.data(document, state.schema);
    const sink = new IssueCollector();
    const context: ContextOf = (path) => ({ kind: "document", operation: "save", path: path.join(".") });
    if (scope === "all") DocumentValidation.all(state, data, context, sink);
    else DocumentValidation.modified(state, data, modifiedPaths, context, sink);
    /* The order of the schema fields, whatever order the (async) validators finished in. */
    await sink.finish(state.schema);
  }

  /**
   * Validates every loaded field.
   *
   * @param state - The document state.
   * @param data - The document's plain data.
   * @param context - Builds the validation context of a path.
   * @param sink - Collects the issues.
   */
  private static all(
    state: DocumentState,
    data: Readonly<Record<string, unknown>>,
    context: ContextOf,
    sink: IssueCollector,
  ): void {
    for (const node of state.schema.fields) {
      if (!DocumentStates.isSelected(state, node.key)) continue;
      if (!Object.hasOwn(data, node.key)) {
        if (node.required) {
          sink.issues.push({
            path: [node.key],
            reason: "required",
            message: "the field is required",
            value: undefined,
          });
        }
        continue;
      }
      ValueValidator.value(node, data[node.key], [node.key], context, sink);
    }
  }

  /**
   * Validates the written paths and the own validators of the containers they sit in.
   *
   * @param state - The document state.
   * @param data - The document's plain data.
   * @param paths - The paths the save writes.
   * @param context - Builds the validation context of a path.
   * @param sink - Collects the issues.
   */
  private static modified(
    state: DocumentState,
    data: Readonly<Record<string, unknown>>,
    paths: readonly string[],
    context: ContextOf,
    sink: IssueCollector,
  ): void {
    /* A path under another validated path is covered by it. */
    const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length);
    const done: string[] = [];
    const owners = new Set<string>();
    for (const path of sorted) {
      if (done.some((other) => path === other || path.startsWith(`${other}.`))) continue;
      done.push(path);
      const resolution = PathResolver.resolve(state.schema, path, "update");
      if (!resolution.ok) continue;
      const segments = path.split(".").map((segment): Segment => (NUMERIC.test(segment) ? Number(segment) : segment));
      const value = DocumentValidation.at(data, segments);
      if (value === undefined) {
        if (resolution.value.node.required) {
          sink.issues.push({ path: segments, reason: "required", message: "the field is required", value: undefined });
        }
      } else {
        ValueValidator.value(resolution.value.node, value, segments, context, sink);
      }
      /* The own validators of the containers on the way (once each). */
      for (let length = 1; length < segments.length; length++) {
        const prefix = segments.slice(0, length);
        const key = prefix.join(".");
        if (owners.has(key) || done.some((other) => key === other || key.startsWith(`${other}.`))) continue;
        const owner = PathResolver.resolve(state.schema, key, "update");
        if (!owner.ok || !DocumentValidation.isContainer(owner.value.node)) continue;
        owners.add(key);
        ValueValidator.own(owner.value.node, DocumentValidation.at(data, prefix), prefix, context, sink);
      }
    }
  }

  /**
   * Whether a node is an array or a Map.
   *
   * @param node - The path node.
   * @returns `true` for an array or Map node.
   */
  private static isContainer(node: PathNode): boolean {
    return node.kind === "array" || node.kind === "map";
  }

  /**
   * The value at `segments` inside plain data.
   *
   * @param data - The plain data to walk.
   * @param segments - The path segments.
   * @returns The value, or `undefined` when absent.
   */
  private static at(data: unknown, segments: readonly Segment[]): unknown {
    let value: unknown = data;
    for (const segment of segments) {
      if (value === null || value === undefined) return undefined;
      if (Array.isArray(value)) value = typeof segment === "number" ? value[segment] : undefined;
      else if (BsonGuards.isMap(value)) value = value.get(String(segment));
      else if (typeof value === "object") value = (value as Record<string, unknown>)[String(segment)];
      else return undefined;
    }
    return value;
  }
}
