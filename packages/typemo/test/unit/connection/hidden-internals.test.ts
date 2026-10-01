import { describe, expect, test } from "bun:test";
import { ClientInternals, ConnectionInternals, TypemoClient } from "../../../src/internal.ts";

describe("core-only members of the client and the connection", () => {
  test("are not own or inherited properties, but the core still reaches them", () => {
    const client = new TypemoClient("mongodb://127.0.0.1:1", { dbName: "hidden" });
    const connection = client.db("hidden");
    for (const name of ["auditTransaction", "extensions", "readyIfNeeded"]) expect(name in client).toBe(false);
    expect("compileContext" in connection).toBe(false);
    expect(ClientInternals.extensions(client).names).toEqual(expect.any(Array));
    expect(ConnectionInternals.compileContext(connection).plugins).toBe(connection.plugins);
  });
});
