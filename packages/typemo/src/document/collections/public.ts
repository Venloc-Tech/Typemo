/* The public API of the typed collections of hydrated documents, re-exported by `src/index.ts` in one line. */
export {
  type CollectionSnapshot,
  Collections,
  type CommitMark,
  type FromStoredOptions,
  type UpdateOpsOptions,
} from "./collections.ts";
export { DirectWriteError } from "./direct-write-error.ts";
export type {
  ElementInput,
  FieldInput,
  HydratedField,
  HydratedFields,
  ObjectData,
  ObjectDoc,
  Subdocument,
  SubdocumentId,
  SubdocumentInput,
  SubdocumentMethods,
} from "./hydrated-types.ts";
export { PartialArrayError } from "./partial-array-error.ts";
export type { StrictArray } from "./strict-array.ts";
export type { SubdocumentArray } from "./subdocument-array.ts";
export type { PathPair, PlainOptions } from "./tracked-protocol.ts";
export type { TypedMap } from "./typed-map.ts";
export { isUnknownFieldsError, type UnknownFields, UnknownFieldsError } from "./unknown-fields-error.ts";
export {
  type CollectionDelta,
  type EachModifier,
  type OpsForm,
  UpdateOps,
  type UpdatePartOperator,
  type UpdateParts,
  type VersionImpact,
} from "./update-ops.ts";
