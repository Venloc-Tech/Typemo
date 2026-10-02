import { type AuditEntry } from "@venloc/typemo";
// ---cut---
export const describeEntry = (entry: AuditEntry): { at: Date; actor: unknown; what: string } => {
  const what = (() => {
    if (entry.operation === "insertOne") return "created";
    if (entry.operation === "deleteOne" || entry.operation === "deleteMany") return "deleted";
    const update = entry.update;
    if (update === undefined || Array.isArray(update)) return entry.operation;
    return Object.entries(update)
      .flatMap(([operator, fields]) =>
        typeof fields === "object" && fields !== null ? Object.keys(fields).map((field) => `${operator} ${field}`) : [],
      )
      .join(", ");
  })();
  return { at: entry.at, actor: entry.actor, what };
};
