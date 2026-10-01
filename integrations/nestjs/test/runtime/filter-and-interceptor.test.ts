// N4–N5 without HTTP: the answers of the error kinds that are hard to provoke over HTTP (built from the core's own
// error classes), `toResponse` overridden, the log of a 500, and the non-HTTP contexts.
import { describe, expect, spyOn, test } from "bun:test";
import type { ArgumentsHost, CallHandler, ExecutionContext } from "@nestjs/common";
import {
  ConfigurationError,
  ConnectionError,
  type ErrorClassification,
  ErrorClassifier,
  PostHookError,
  VersionError,
} from "@venloc/typemo";
import { of } from "rxjs";
import { PolicyInterceptor, TypemoExceptionFilter, type TypemoHttpResponse } from "../../src/index.ts";

/** A host of the given type that records what the filter sends. */
const host = (type = "http"): { readonly host: ArgumentsHost; readonly sent: { status?: number; body?: unknown } } => {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return {
        json(body: unknown) {
          sent.body = body;
        },
      };
    },
  };
  return {
    sent,
    /* cast: a minimal fake of the Nest host, only the members the filter reads */
    host: { getType: () => type, switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost,
  };
};

const filter = new TypemoExceptionFilter();
const answerOf = (error: Error): TypemoHttpResponse => filter.toResponse(error, ErrorClassifier.classify(error));

describe("TypemoExceptionFilter.toResponse", () => {
  test("a version conflict is 409", () => {
    expect(answerOf(new VersionError("NtAccount", 3, ["balance"])).status).toBe(409);
  });

  test("no connection is 503", () => {
    expect(answerOf(new ConnectionError("server-selection", "no server available")).body).toEqual({
      statusCode: 503,
      error: "Service Unavailable",
      message: "The database is unavailable",
    });
  });

  test("a PostHookError is 500 and is logged as applied", () => {
    const lines: string[] = [];
    const spy = spyOn(filter.logger, "error").mockImplementation((message: unknown) => {
      lines.push(String(message));
    });
    try {
      const { host: h, sent } = host();
      filter.catch(new PostHookError("NtJournal", "save", undefined, { cause: new Error("boom") }), h);
      expect(sent.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(lines[0]).toStartWith("PostHookError (the write was applied): ");
  });

  test("a configuration error is 500", () => {
    expect(answerOf(new ConfigurationError("bad")).status).toBe(500);
  });

  test("toResponse can be overridden", () => {
    class TeapotFilter extends TypemoExceptionFilter {
      override toResponse(error: unknown, classification: ErrorClassification): TypemoHttpResponse {
        if (classification.kind === "not-found") return { status: 418, body: { message: "no tea" } };
        return super.toResponse(error, classification);
      }
    }
    const { host: h, sent } = host();
    new TeapotFilter().catch(new ConfigurationError("x"), h);
    expect(sent.status).toBe(500);
  });

  test("outside HTTP the filter rethrows", () => {
    const error = new ConfigurationError("rpc");
    expect(() => filter.catch(error, host("rpc").host)).toThrow(error);
  });
});

describe("PolicyInterceptor", () => {
  const context = (type: string): ExecutionContext =>
    ({
      getType: () => type,
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ headers: { "x-tenant": "acme" } }) }),
    }) as unknown as ExecutionContext; /* cast: a minimal fake of the Nest context, only the members the interceptor reads */
  const next: CallHandler = { handle: () => of("done") };

  test("refuses a context other than HTTP", () => {
    const interceptor = new PolicyInterceptor({ tenant: (request) => request.headers["x-tenant"] });
    expect(() => interceptor.intercept(context("rpc"), next)).toThrow(
      'PolicyInterceptor works in HTTP handlers only, got a "rpc" context',
    );
  });

  test("a resolver that is not a function is refused at construction", () => {
    expect(() => new PolicyInterceptor({ tenant: "acme" as never })).toThrow(
      "PolicyInterceptor: tenant is a function of the request, got string",
    );
  });

  test("a resolver that returns a promise is refused", () => {
    const interceptor = new PolicyInterceptor({ tenant: async () => "acme" });
    expect(() => interceptor.values(context("http"))).toThrow(
      "PolicyInterceptor: tenant returned a promise; resolve it from the request at once",
    );
  });

  test("values: the tenant and the actor", () => {
    const interceptor = new PolicyInterceptor({ tenant: (request) => request.headers["x-tenant"], actor: () => "ann" });
    expect(interceptor.values(context("http"))).toEqual({ tenant: "acme", actor: "ann" });
  });
});
