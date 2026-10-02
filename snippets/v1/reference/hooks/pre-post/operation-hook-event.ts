type DocumentHookEvent = "document.save" | "document.validate" | "document.init" | "document.updateOne" | "document.deleteOne";
type ModelHookEvent = "model.insertMany" | "model.bulkWrite";
type OperationHookEvent = Exclude<HookEvent, DocumentHookEvent>;
type HookEvent = DocumentHookEvent | QueryHookEvent | ModelHookEvent | "aggregate";
