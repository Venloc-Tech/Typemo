import type { InstrumentationSubscriber } from "@venloc/typemo";

const open = new Map<number, { startedAt: number; parentId: number | undefined }>();

export const timer: InstrumentationSubscriber = {
  handle: (event) => {
    if (event.type === "operation.start") {
      open.set(event.operationId, { startedAt: event.timestamp, parentId: event.parentId });
    } else if (event.type === "operation.end" || event.type === "operation.error") {
      open.delete(event.operationId); // do not forget: otherwise the map grows
    }
  },
};
