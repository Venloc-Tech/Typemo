/*
 * Fills the core's `PolicyContext` from the HTTP request, for everything the handler calls: the tenant and the actor
 * come from the request, `@AllTenants()` opens cross-tenant access for one handler or controller. Nest calls the
 * handler inside `defer(AsyncResource.bind(...))`, bound when `next.handle()` is called, so calling it inside
 * `PolicyContext.run` makes the handler (and every `await` in it) see the values.
 */
import { type CallHandler, type ExecutionContext, type NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigurationError, PolicyContext, type PolicyValues } from "@venloc/typemo";
import type { Observable } from "rxjs";

/** The metadata key of `@AllTenants()`. */
const ALL_TENANTS = "typemo:all-tenants";

/**
 * The part of an HTTP request the resolvers usually read; declare your own type (`PolicyInterceptor<Request>`)
 * for the rest.
 *
 * @example
 * ```ts
 * const tenantOf = (request: PolicyRequest): unknown => request.headers["x-tenant"];
 * ```
 */
export interface PolicyRequest {
  /** The request headers. */
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

/**
 * Where the interceptor takes the policy values from.
 *
 * @typeParam R - The request type.
 * @example
 * ```ts
 * const options: PolicyInterceptorOptions = { tenant: (request) => request.headers["x-tenant"] };
 * ```
 */
export interface PolicyInterceptorOptions<R = PolicyRequest> {
  /**
   * The tenant of the request; `undefined` sets none (a tenant model then refuses the operation). An empty value
   * (`null`, `""`) is refused by the core: a tenant is a value, cross-tenant access is `@AllTenants()`.
   */
  readonly tenant?: (request: R) => unknown;
  /** The actor written to the audit entries; `undefined` sets none. */
  readonly actor?: (request: R) => unknown;
}

/**
 * Marks a handler or a controller as cross-tenant: the interceptor sets `allTenants: true` instead of the tenant.
 *
 * @returns A method or class decorator.
 * @example
 * ```ts
 * @Controller("admin/accounts")
 * class AdminController {
 *   @AllTenants()
 *   @Get()
 *   list(): string[] {
 *     return [];
 *   }
 * }
 * ```
 */
export const AllTenants = (): MethodDecorator & ClassDecorator => SetMetadata(ALL_TENANTS, true);

/**
 * The interceptor that runs each HTTP handler inside `PolicyContext.run` with the values of its request.
 *
 * @typeParam R - The request type the resolvers read.
 * @example
 * ```ts
 * const interceptor = new PolicyInterceptor({ tenant: (request) => request.headers["x-tenant"] });
 * ```
 */
export class PolicyInterceptor<R = PolicyRequest> implements NestInterceptor {
  readonly #options: PolicyInterceptorOptions<R>;
  readonly #reflector = new Reflector();

  /**
   * @param options - The tenant and actor resolvers.
   * @throws {ConfigurationError} When a resolver is not a function.
   */
  constructor(options: PolicyInterceptorOptions<R>) {
    for (const key of ["tenant", "actor"] as const) {
      const value = (options as Readonly<Record<string, unknown>> | undefined)?.[key];
      if (value !== undefined && typeof value !== "function") {
        throw new ConfigurationError(`PolicyInterceptor: ${key} is a function of the request, got ${typeof value}`);
      }
    }
    this.#options = options;
  }

  /**
   * The policy values of one request.
   *
   * @param context - The execution context.
   * @returns The values.
   * @throws {ConfigurationError} When the context is not HTTP or a resolver returned a promise.
   */
  values(context: ExecutionContext): PolicyValues {
    if (context.getType() !== "http") {
      throw new ConfigurationError(
        `PolicyInterceptor works in HTTP handlers only, got a "${context.getType()}" context`,
      );
    }
    const request = context.switchToHttp().getRequest<R>();
    const resolve = (key: "tenant" | "actor"): unknown => {
      const value = this.#options[key]?.(request);
      if (value instanceof Promise) {
        throw new ConfigurationError(
          `PolicyInterceptor: ${key} returned a promise; resolve it from the request at once`,
        );
      }
      return value;
    };
    const all = this.#reflector.getAllAndOverride<boolean | undefined>(ALL_TENANTS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const actor = resolve("actor");
    const tenant = all === true ? undefined : resolve("tenant");
    return {
      ...(all === true ? { allTenants: true as const } : tenant === undefined ? {} : { tenant }),
      ...(actor === undefined ? {} : { actor }),
    };
  }

  /**
   * Runs the handler inside `PolicyContext.run`.
   *
   * @param context - The execution context.
   * @param next - The handler.
   * @returns The handler's stream.
   */
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const values = this.values(context);
    return PolicyContext.run(values, () => next.handle());
  }
}
