import { ErrorLabels, ServerError } from "@venloc/typemo";
declare const error: ServerError;
// ---cut---
if (error.hasErrorLabel(ErrorLabels.TransientTransactionError)) {
  // the whole transaction can be run again
}
