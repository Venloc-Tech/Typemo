import { PolicyInterceptor } from "@venloc/typemo-nestjs";
// ---cut---
interface AuthRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly user: { readonly orgId: string; readonly id: string };
}

const interceptor = new PolicyInterceptor<AuthRequest>({
  tenant: (request) => request.user.orgId,
  actor: (request) => request.user.id,
});
