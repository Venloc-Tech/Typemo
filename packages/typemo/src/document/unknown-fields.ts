import { Collections } from "./collections/collections.ts";
import type { UnknownFields } from "./collections/unknown-fields-error.ts";
import { DocumentStates } from "./document-state.ts";

/**
 * A document as a bag of fields.
 *
 * @example
 * ```ts
 * const doc: Doc = { name: "Ada" };
 * ```
 */
type Doc = Record<string, unknown>;

/**
 * The stored subdocuments with fields unknown to the schema inside a hydrated document, a subdocument or a
 * tracked container (paths are code paths inside the root document). The keys are remembered when a
 * document is read (no query); a save that would rewrite or replace such a subdocument refuses with
 * `UnknownFieldsError` unless `dropUnknownFields: true` accepts the loss. Unknown keys of the ROOT document
 * are never rewritten by a save (it only `$set`s fields) and are not listed.
 *
 * @param value - A hydrated document, a subdocument or a tracked container.
 * @returns The subdocuments with unknown stored keys; `[]` when there are none.
 */
export const unknownFieldsOf = (value: object): readonly UnknownFields[] => {
  if (!DocumentStates.is(value)) return Collections.unknownFields(value, Collections.fullPath(value) ?? "");
  const state = DocumentStates.of(value);
  const doc = value as Doc;
  return state.schema.fields.flatMap((node) =>
    Object.hasOwn(doc, node.key) ? Collections.unknownFields(doc[node.key], node.key) : [],
  );
};
