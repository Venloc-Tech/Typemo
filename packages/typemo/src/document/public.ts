/* The public API of hydrated documents, re-exported by `src/index.ts` in one line. */

export type {
  AnyPopulationDoc,
  AnyPopulationMethods,
  PartlyPopulatedDoc,
  PopulatableKeys,
} from "./any-population-doc.ts";
export type {
  DocumentChanges,
  DocumentMethods,
  DocumentPaths,
  DocumentValue,
  FieldsWith,
  GetterVirtualKeys,
  HiddenKeys,
  HydratedDoc,
  HydratedDocWith,
  SavableDocument,
  SaveOptions,
  SerializeOptions,
  ToJsonResult,
  ToObjectOptions,
  ToObjectResult,
  ToPlainResult,
} from "./document-types.ts";
export { unknownFieldsOf } from "./unknown-fields.ts";
