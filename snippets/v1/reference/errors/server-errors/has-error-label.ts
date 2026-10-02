import { ErrorLabels, ServerError } from "@venloc/typemo";
declare const error: ServerError;
// ---cut---
const canRetryTransaction = error.hasErrorLabel(ErrorLabels.TransientTransactionError);
