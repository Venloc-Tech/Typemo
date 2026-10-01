// N4–N5 over HTTP (Express, Bun's fetch): every kind of error to a status and a body without leaks, the id and body
// pipes, the tenant and actor from the request with @AllTenants, @Transactional on a route handler.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type INestApplication, Module } from "@nestjs/common";
import type { TypemoClient } from "@venloc/typemo";
import { FailPointHelpers } from "@venloc/typemo-test-kit";
import { getClientToken, PolicyInterceptor, TypemoExceptionFilter, TypemoModule } from "../../src/index.ts";
import { NestTest } from "../support/nest-test.ts";
import { E2eFeatureModule } from "./app.ts";

let app: INestApplication;
let url: string;

/** Sends a request and returns the status and the parsed body. */
const call = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ readonly status: number; readonly body: unknown; readonly text: string }> => {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, body: parsed, text };
};

beforeAll(async () => {
  @Module({
    imports: [
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("http"), sync: "init" }),
      E2eFeatureModule,
    ],
  })
  class AppModule {}
  ({ app, url } = await NestTest.app(AppModule, (application) => {
    application.useGlobalFilters(new TypemoExceptionFilter());
    application.useGlobalInterceptors(
      new PolicyInterceptor({
        tenant: (request) => request.headers["x-tenant"],
        actor: (request) => request.headers["x-user"],
      }),
    );
  }));
});
afterAll(() => app.close());

describe("errors to HTTP answers", () => {
  test("a duplicate key is 409 with the field names, never the values", async () => {
    expect((await call("POST", "/users", { email: "ann@x.io", name: "Ann" })).status).toBe(201);
    const duplicate = await call("POST", "/users", { email: "ann@x.io", name: "Ann" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({
      statusCode: 409,
      error: "Conflict",
      message: "Duplicate value",
      fields: ["email"],
    });
    expect(duplicate.text).not.toContain("ann@x.io");
  });

  test("a duplicate _id from the raw driver is 409 too", async () => {
    const response = await call("POST", "/users/raw-duplicate");
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ statusCode: 409, error: "Conflict", message: "Duplicate value", fields: ["_id"] });
  });

  test("any other driver error is 500 without the server's text", async () => {
    const response = await call("POST", "/users/raw-other");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal server error",
    });
    expect(response.text).not.toContain("thisCommandDoesNotExist");
  });

  test("a cast error in a filter is 400 with the path", async () => {
    const response = await call("GET", "/users?age=old");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ statusCode: 400, error: "Bad Request", message: "Invalid value", path: "age" });
  });

  test("an unknown path in a filter (strict) is 400 with the path", async () => {
    const response = await call("GET", "/users/by/unknown");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "Not allowed",
      reason: "unknown-path",
      path: "filter.nickname",
    });
  });

  test("orFail() that finds nothing is 404", async () => {
    const response = await call("GET", "/users/6abcb88b25109dc2cd5d67c3");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ statusCode: 404, error: "Not Found", message: "Not found" });
  });

  test("a timeout is 504", async () => {
    const driver = app.get<TypemoClient>(getClientToken()).unsafeDriver();
    const failPoint = await FailPointHelpers.configureFailCommand(driver, {
      failCommands: ["find"],
      blockConnection: true,
      blockTimeMS: 300,
      times: 1,
    });
    try {
      const response = await call("GET", "/users/slow/50");
      expect(response.status).toBe(504);
      expect(response.body).toEqual({
        statusCode: 504,
        error: "Gateway Timeout",
        message: "The database took too long",
      });
    } finally {
      await failPoint.disable();
    }
  });

  test("a transient server error outside a known kind is 503", async () => {
    const driver = app.get<TypemoClient>(getClientToken()).unsafeDriver();
    const failPoint = await FailPointHelpers.configureFailCommand(driver, {
      failCommands: ["find"],
      errorCode: 251,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    try {
      const response = await call("GET", "/users");
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ statusCode: 503, error: "Service Unavailable", message: "Try again" });
    } finally {
      await failPoint.disable();
    }
  });

  test("a hook that fails after the write is 500 (the write stays)", async () => {
    const response = await call("POST", "/journal", { title: "explode" });
    expect(response.status).toBe(500);
    expect(response.text).not.toContain("hook after the save");
  });
});

describe("ValidateBodyPipe", () => {
  test("every failing field is a 422 with its message", async () => {
    const response = await call("POST", "/users", { email: "bob@x.io", name: "B", age: 200, role: "root" });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      statusCode: 422,
      error: "Unprocessable Entity",
      message: "Validation failed",
      errors: {
        name: "must be at least 2 characters long",
        age: "must be at most 150",
        role: 'must be one of "user", "admin"',
      },
    });
  });

  test("an unknown field is a 422 by default", async () => {
    const response = await call("POST", "/users", { email: "c@x.io", name: "Cy", nickname: "c" });
    expect(response.status).toBe(422);
    expect((response.body as { errors: unknown }).errors).toEqual({ nickname: "not a field of NtUser" });
  });

  test("dropUnknown drops it", async () => {
    const response = await call("POST", "/users/lenient", { email: "d@x.io", name: "Dee", nickname: "d" });
    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty("nickname");
  });

  test("omit refuses a field the caller must not set", async () => {
    const response = await call("POST", "/users/strict-role", { email: "e@x.io", name: "Eve", role: "admin" });
    expect(response.status).toBe(422);
    expect((response.body as { errors: unknown }).errors).toEqual({ role: "not allowed here" });
  });

  test("pick keeps only the listed fields; the result is the cast fields that were sent", async () => {
    const response = await call("POST", "/users/names", { email: "f@x.io", name: "Fay" });
    expect(response.body).toEqual({ email: "f@x.io", name: "Fay" });
  });

  test("a string for a number is refused, not converted", async () => {
    const response = await call("POST", "/users", { email: "g@x.io", name: "Gus", age: "30" });
    expect(response.status).toBe(422);
    expect(Object.keys((response.body as { errors: object }).errors)).toEqual(["age"]);
  });

  test("partial checks only the fields that were sent", async () => {
    const created = await call("POST", "/users", { email: "h@x.io", name: "Hal" });
    const id = (created.body as { _id: string })._id;
    const renamed = await call("PATCH", `/users/${id}`, { name: "Hank" });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { name: string }).name).toBe("Hank");
    const bad = await call("PATCH", `/users/${id}`, { age: -1 });
    expect(bad.status).toBe(422);
    expect((bad.body as { errors: unknown }).errors).toEqual({ age: "must be at least 0" });
  });

  test("partial refuses _id and the fields the core maintains", async () => {
    const created = await call("POST", "/users", { email: "j@x.io", name: "Jo" });
    const id = (created.body as { _id: string })._id;
    const response = await call("PATCH", `/users/${id}`, {
      _id: id,
      createdAt: "2026-01-01T00:00:00.000Z",
      name: "Joe",
    });
    expect(response.status).toBe(422);
    expect((response.body as { errors: unknown }).errors).toEqual({
      _id: "cannot be changed",
      createdAt: "cannot be changed",
    });
  });

  test("a sensitive field's value does not reach the answer", async () => {
    const response = await call("POST", "/users", { email: "i@x.io", name: "Ivy", phone: 5550123 });
    expect(response.status).toBe(422);
    expect(response.text).not.toContain("5550123");
  });

  test("a body that is not an object", async () => {
    const response = await call("POST", "/users", [1, 2]);
    expect(response.status).toBe(422);
    expect((response.body as { errors: unknown }).errors).toEqual({ "": "expected an object" });
  });
});

describe("ParseIdPipe", () => {
  test("a malformed ObjectId is 400 with a clear text", async () => {
    const response = await call("GET", "/users/not-an-id");
    expect(response.status).toBe(400);
    expect((response.body as { message: string }).message).toBe(
      "Invalid id: expected ObjectId (not a 24-character hex string)",
    );
  });

  test("a string id, a numeric id and a UUID", async () => {
    expect((await call("GET", "/ids/country/FR")).body).toEqual({ id: "FR", type: "string" });
    expect((await call("GET", "/ids/ticket/42")).body).toEqual({ id: 42, type: "number" });
    const bad = await call("GET", "/ids/ticket/42abc");
    expect(bad.status).toBe(400);
    expect((bad.body as { message: string }).message).toBe("Invalid id: expected number (expected a number)");
    expect((await call("GET", "/ids/session/0c5a3f33-6c34-4c3f-9e0b-0d7f6a9a3b1e")).body).toEqual({
      id: "0c5a3f33-6c34-4c3f-9e0b-0d7f6a9a3b1e",
      type: "UUID",
    });
    expect((await call("GET", "/ids/session/nope")).status).toBe(400);
  });
});

describe("@Transactional on a route handler", () => {
  test("the route still exists and commits", async () => {
    const response = await call("POST", "/accounts/pair", { title: "pair" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ count: 2 });
  });

  test("the decorator below the route decorator works too", async () => {
    expect((await call("POST", "/accounts/pair-below", { title: "below" })).status).toBe(500);
    expect((await call("GET", "/accounts/count/below")).body).toEqual({ count: 0 });
  });

  test("a failure rolls back the first write", async () => {
    const response = await call("POST", "/accounts/pair", { title: "half", fail: true });
    expect(response.status).toBe(500);
    expect((await call("GET", "/accounts/count/half")).body).toEqual({ count: 0 });
  });
});

describe("tenant and actor from the request", () => {
  test("each tenant sees its own orders, also after awaits and through an Observable", async () => {
    await call("POST", "/orders", { number: "A-1" }, { "x-tenant": "acme" });
    await call("POST", "/orders", { number: "A-2" }, { "x-tenant": "acme" });
    await call("POST", "/orders", { number: "G-1" }, { "x-tenant": "globex" });
    expect((await call("GET", "/orders", undefined, { "x-tenant": "acme" })).body).toEqual(["A-1", "A-2"]);
    expect((await call("GET", "/orders", undefined, { "x-tenant": "globex" })).body).toEqual(["G-1"]);
    expect((await call("GET", "/orders/stream", undefined, { "x-tenant": "globex" })).body).toEqual(["G-1"]);
  });

  test("@AllTenants() reads across tenants", async () => {
    expect((await call("GET", "/orders/all")).body).toEqual(["acme:A-1", "acme:A-2", "globex:G-1"]);
  });

  test("without a tenant a tenant model refuses the operation", async () => {
    const response = await call("GET", "/orders");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ statusCode: 400, error: "Bad Request", message: "Not allowed", reason: "tenant" });
  });

  test("the actor of the request", async () => {
    expect((await call("GET", "/orders/actor", undefined, { "x-tenant": "acme", "x-user": "ann" })).body).toEqual({
      actor: "ann",
      tenant: "acme",
    });
  });

  test("concurrent requests do not see each other's tenant", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call("GET", "/orders", undefined, { "x-tenant": i % 2 === 0 ? "acme" : "globex" }),
      ),
    );
    for (const [i, result] of results.entries()) expect(result.body).toEqual(i % 2 === 0 ? ["A-1", "A-2"] : ["G-1"]);
  });
});
