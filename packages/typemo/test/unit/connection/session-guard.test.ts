/*
 * The concurrency rule of one session, without a server. In a transaction one operation is in flight; in an
 * explicit session without a transaction reads may overlap each other, a write only runs alone. (The server
 * evidence is in test/runtime/connection/transactions.test.ts.)
 */
import { describe, expect, test } from "bun:test";
import type { ClientSession } from "mongodb";
import { SessionGuard, StrictModeError } from "../../../src/internal.ts";

/** A `ClientSession` stand-in that only knows `inTransaction()`. */
/* cast: a test double / bridge — a ClientSession stand-in with only inTransaction() */
const session = (inTransaction: boolean) => ({ inTransaction: () => inTransaction }) as unknown as ClientSession;

/** Runs `fn` and returns the `StrictModeError` it throws; anything else fails the test. */
const refused = (fn: () => unknown): StrictModeError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StrictModeError);
    return error as StrictModeError;
  }
  throw new Error("expected a concurrent-session error");
};

describe("SessionGuard", () => {
  test("outside a transaction: reads overlap; the session is free again when they finish", () => {
    const s = session(false);
    const a = SessionGuard.enter(s, "A.find", "read");
    const b = SessionGuard.enter(s, "A.countDocuments", "read");
    expect(SessionGuard.busy(s)).toBe(true);
    a();
    expect(SessionGuard.busy(s)).toBe(true);
    b();
    expect(SessionGuard.busy(s)).toBe(false);
    SessionGuard.enter(s, "A.updateOne", "write")();
  });

  test("outside a transaction: a write next to a read, a read next to a write, two writes — refused", () => {
    const s = session(false);
    const read = SessionGuard.enter(s, "A.find", "read");
    expect(refused(() => SessionGuard.enter(s, "A.updateOne", "write")).message).toMatch(/in use by A\.find/);
    read();
    const write = SessionGuard.enter(s, "A.insertOne", "write");
    expect(refused(() => SessionGuard.enter(s, "A.find", "read")).reason).toBe("concurrent-session");
    expect(refused(() => SessionGuard.enter(s, "A.insertOne", "write")).message).toMatch(/only reads may overlap/);
    write();
    expect(SessionGuard.busy(s)).toBe(false);
  });

  test("in a transaction: nothing overlaps, reads included (server code 117)", () => {
    const s = session(true);
    const read = SessionGuard.enter(s, "A.find", "read");
    expect(refused(() => SessionGuard.enter(s, "A.findOne", "read")).message).toMatch(/outside a transaction/);
    read();
  });

  test("the default access is a write (unknown operations are never let through)", () => {
    const s = session(false);
    const first = SessionGuard.enter(s, "A.op");
    refused(() => SessionGuard.enter(s, "A.find", "read"));
    first();
  });

  test("a release runs once: releasing twice does not free another operation's slot", () => {
    const s = session(false);
    const a = SessionGuard.enter(s, "A.find", "read");
    const b = SessionGuard.enter(s, "A.find", "read");
    a();
    a();
    expect(SessionGuard.busy(s)).toBe(true);
    b();
  });
});
