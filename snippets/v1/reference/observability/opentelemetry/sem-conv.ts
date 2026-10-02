import { SemConv } from "@venloc/typemo-opentelemetry";

const isTypemoSpan = (attributes: Record<string, unknown>): boolean =>
  attributes[SemConv.DB_SYSTEM_NAME] === SemConv.DB_SYSTEM_NAME_VALUE_MONGODB;
