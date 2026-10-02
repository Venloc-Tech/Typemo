import { ErrorClassifier } from "@venloc/typemo";
declare const error: unknown;
// ---cut---
const { kind, code, retryable } = ErrorClassifier.classify(error);
