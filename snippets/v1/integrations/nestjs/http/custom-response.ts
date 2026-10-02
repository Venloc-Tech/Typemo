import type { ErrorClassification } from "@venloc/typemo";
import { TypemoExceptionFilter, type TypemoHttpResponse } from "@venloc/typemo-nestjs";
// ---cut---
export class ApiExceptionFilter extends TypemoExceptionFilter {
  override toResponse(error: unknown, classification: ErrorClassification): TypemoHttpResponse {
    if (classification.kind === "duplicate-key") return { status: 409, body: { code: "ALREADY_EXISTS" } };
    return super.toResponse(error, classification);
  }
}
