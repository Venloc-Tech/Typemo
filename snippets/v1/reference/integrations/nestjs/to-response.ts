import type { ErrorClassification } from "@venloc/typemo";
import { TypemoExceptionFilter, type TypemoHttpResponse } from "@venloc/typemo-nestjs";
// ---cut---
export class ApiExceptionFilter extends TypemoExceptionFilter {
  override toResponse(error: unknown, classification: ErrorClassification): TypemoHttpResponse {
    if (classification.kind === "not-found") return { status: 404, body: { code: "NOT_FOUND" } };
    return super.toResponse(error, classification);
  }
}
