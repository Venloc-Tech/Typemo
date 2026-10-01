/* Client options — typed, conflicts are errors, never mutated (Mongoose H328). */
import { describe, expect, test } from "bun:test";
import { ClientOptions } from "../../../src/connection/client-options.ts";
import { ConfigurationError, TypemoClient, type TypemoClientOptions } from "../../../src/index.ts";

describe("ClientOptions.resolve", () => {
  test("splits Typemo's options from the driver's and enforces the BSON options", () => {
    const resolved = ClientOptions.resolve("mongodb://h/app", { readyTimeoutMS: 500, name: "main", maxPoolSize: 5 });
    expect(resolved.readyTimeoutMS).toBe(500);
    expect(resolved.name).toBe("main");
    expect(resolved.dbName).toBe("app");
    expect(resolved.driver).toMatchObject({ maxPoolSize: 5, useBigInt64: true, promoteBuffers: false });
    expect("readyTimeoutMS" in resolved.driver).toBe(false);
  });

  test("defaults: readyTimeoutMS 10 s, name default, database test", () => {
    const resolved = ClientOptions.resolve("mongodb://h:1/?replicaSet=rs");
    expect([resolved.readyTimeoutMS, resolved.name, resolved.dbName]).toEqual([10_000, "default", "test"]);
  });

  test.each([
    ["a BSON option against Typemo's", "mongodb://h", { promoteLongs: false } as never, /promoteLongs/],
    [
      "dbName against the URI database",
      "mongodb://h/one",
      { dbName: "two" },
      /dbName "two" conflicts with the database "one"/,
    ],
    [
      "a legacy timeout option",
      "mongodb://h",
      { socketTimeoutMS: 5 } as never,
      /socketTimeoutMS is not supported; use timeoutMS/,
    ],
    ["a legacy timeout in the URI", "mongodb://h/?waitQueueTimeoutMS=5", {}, /waitQueueTimeoutMS is not supported/],
    [
      "a negative readyTimeoutMS",
      "mongodb://h",
      { readyTimeoutMS: -1 },
      /readyTimeoutMS must be a non-negative integer/,
    ],
    ["a fractional timeoutMS", "mongodb://h", { timeoutMS: 1.5 }, /timeoutMS must be a non-negative integer/],
    ["an empty name", "mongodb://h", { name: "" }, /name must be a non-empty string/],
    ["not a connection string", "http://h", {}, /connection string/],
  ])("%s is a ConfigurationError", (_, uri, options, message) => {
    expect(() => ClientOptions.resolve(uri, options as TypemoClientOptions)).toThrow(ConfigurationError);
    expect(() => ClientOptions.resolve(uri, options as TypemoClientOptions)).toThrow(message);
  });

  test("the input is not mutated (frozen input works) and the result is frozen", () => {
    const input = Object.freeze({ readyTimeoutMS: 1, maxPoolSize: 2, name: "x" });
    const resolved = ClientOptions.resolve("mongodb://h", input);
    expect(input).toEqual({ readyTimeoutMS: 1, maxPoolSize: 2, name: "x" });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.driver)).toBe(true);
  });

  test("new TypemoClient does not connect and starts idle", async () => {
    const client = new TypemoClient("mongodb://127.0.0.1:1/", { serverSelectionTimeoutMS: 100 });
    expect(client.state).toBe("idle");
    await client.close();
    expect(client.state).toBe("closed");
  });
});
