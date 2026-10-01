/* The public API of change streams, re-exported by `src/index.ts`. */
export type {
  ChangeEvent,
  ChangeEventBase,
  CollectionEvent,
  DeleteEvent,
  DocumentOperationType,
  EventDoc,
  EventOf,
  FullDocumentBeforeChangeOption,
  FullDocumentOption,
  InsertEvent,
  ModelWatchOptions,
  PostImage,
  PreImage,
  ReplaceEvent,
  UpdateDescription,
  UpdateEvent,
} from "./change-events.ts";

export { ModelChangeStream } from "./model-change-stream.ts";
