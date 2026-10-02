import { PolicyContext } from "@venloc/typemo";
// ---cut---
export const asActor = <R>(userId: string, work: () => R): R => PolicyContext.run({ actor: userId }, work);
