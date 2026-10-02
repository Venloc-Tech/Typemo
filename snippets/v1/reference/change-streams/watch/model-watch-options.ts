interface ModelWatchOptions<Include extends string = string> {
  readonly include?: readonly Include[];
  readonly fullDocument?: "default" | "updateLookup" | "whenAvailable" | "required";
  readonly fullDocumentBeforeChange?: "off" | "whenAvailable" | "required";
  readonly hydrate?: boolean;
  readonly resumeAfter?: ResumeToken;
  readonly startAfter?: ResumeToken;
  readonly startAtOperationTime?: Timestamp;
  readonly maxAwaitTimeMS?: number;
  readonly batchSize?: number;
  readonly showExpandedEvents?: boolean;
}
