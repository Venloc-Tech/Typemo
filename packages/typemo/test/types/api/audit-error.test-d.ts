/* `AuditError.applied` is the literal `false`, and the constructor takes no `applied` argument. */
import { expectTypeOf } from "expect-type";
import { AuditError } from "../../../src/index.ts";

declare const error: AuditError;
expectTypeOf(error.applied).toEqualTypeOf<false>();
/* The model, the operation and the optional options: two or three arguments, none of them a boolean. */
expectTypeOf<ConstructorParameters<typeof AuditError>["length"]>().toEqualTypeOf<2 | 3>();
expectTypeOf<ConstructorParameters<typeof AuditError>[2]>().not.toEqualTypeOf<boolean>();
// @ts-expect-error the third argument is the options object; a boolean `applied` is gone
new AuditError("User", "updateOne", false);
