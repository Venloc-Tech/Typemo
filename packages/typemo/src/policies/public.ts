/*
 * The public API of the policies — strictness and the application policies tenant, soft delete and audit —
 * re-exported by `src/index.ts` in one line. The policy classes are internal (`src/internal.ts`); the user sees
 * their options, `Filters`, `SoftDelete`, `untrusted`, `Mask` and the context types.
 */
export type {
  DocumentValidationContext,
  UpdateValidationContext,
  ValidationContext,
} from "../schema/options/prop-options.ts";
export type { AuditEntry } from "./audit-policy.ts";
export { type AllDocumentsFilter, Filters } from "./filters.ts";
export { Mask, type MaskChoice, type MaskOf, type MeasurableValue, type RoundableValue } from "./mask.ts";
export { PolicyContext, type PolicyValues } from "./policy-context.ts";
export { SENSITIVE_HIDDEN, SENSITIVE_MASK } from "./sensitive-mask.ts";
export { SoftDelete } from "./soft-delete.ts";
export { Untrusted, type UntrustedPlace, untrusted } from "./untrusted.ts";
