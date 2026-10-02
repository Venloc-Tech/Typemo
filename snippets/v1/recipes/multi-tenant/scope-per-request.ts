import { PolicyContext } from "@venloc/typemo";
class __Unauthorized__ extends Error {}
declare const __verifyToken__: (token: string) => { readonly orgId: string; readonly userId: string } | null;
// ---cut---
export const handle = async <R>(token: string, work: () => Promise<R>): Promise<R> => {
  const identity = __verifyToken__(token);
  if (identity === null || identity.orgId === "") throw new __Unauthorized__("invalid token");
  return PolicyContext.run({ tenant: identity.orgId, actor: identity.userId }, work);
};
