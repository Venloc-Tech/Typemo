/*
 * The hub takes the error of `operation.error` and the failure of `driver.command.failed` only as a
 * `MaskedError`, and `SensitiveMask` is its only producer. A new event channel that hands a raw error to
 * subscribers does not compile; a cast to the brand outside `SensitiveMask` fails the scan below.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ErrorClassification } from "../../../src/errors/error-classifier.ts";
import type { MaskedError, OperationInfo } from "../../../src/instrumentation/instrumentation-events.ts";
import { DuplicateKeyError, InstrumentationHub } from "../../../src/internal.ts";
import { SensitiveMask } from "../../../src/policies/sensitive-mask.ts";

const SRC = join(import.meta.dir, "../../../src");

/** Every `.ts` file under `dir`, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });

describe("MaskedError: the hub takes only masked errors", () => {
  test("type: a raw error in operation.error / driver.command.failed does not compile", () => {
    const hub = new InstrumentationHub(undefined);
    const raw: unknown = new Error('dup key: { email: "a@b.c" }');
    /* cast: the type test needs only the shape of the operation's info and classification */
    const info = {} as OperationInfo;
    /* cast: as above */
    const classification = {} as ErrorClassification;
    const failed = { ...info, type: "operation.error", timestamp: 0, durationMS: 0, failedStep: "execute" } as const;
    // @ts-expect-error — `error` must be a MaskedError (SensitiveMask.error), not a raw error
    expect(() => hub.emit({ ...failed, error: raw, classification })).not.toThrow();
    hub.emit({ ...failed, error: SensitiveMask.error(undefined, raw, "mask"), classification });
    const command = {
      type: "driver.command.failed",
      operationId: 1,
      requestId: 1,
      commandName: "insert",
      databaseName: "db",
      address: "h",
      timestamp: 0,
      durationMS: 1,
      command: undefined,
    } as const;
    // @ts-expect-error — `failure` must be a MaskedError (SensitiveMask.failure), not the driver's error
    hub.emit({ ...command, failure: raw as Error });
    hub.emit({ ...command, failure: SensitiveMask.failure(undefined, raw, "mask") });
    hub.emit({ ...command, failure: undefined });
    /* The error of a transaction event is masked too (SensitiveMask.transaction). */
    const transaction = {
      type: "transaction.abort",
      transactionId: 1,
      timestamp: 0,
      attempt: 1,
      connection: "c",
      durationMS: 1,
    } as const;
    // @ts-expect-error — `error` must be a MaskedError (SensitiveMask.transaction), not a raw error
    hub.emit({ ...transaction, error: raw });
    hub.emit({ ...transaction, error: SensitiveMask.transaction(raw, "mask") });
    hub.emit({ ...transaction, error: undefined });
  });

  test("SensitiveMask is the only producer: no cast to MaskedError anywhere else in src", () => {
    const offenders = files(SRC).filter(
      (path) =>
        !path.endsWith("sensitive-mask.ts") && /as\s+MaskedError\b|<MaskedError>/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
    /* …and inside it only the one `brand` helper casts. */
    const own = readFileSync(join(SRC, "policies/sensitive-mask.ts"), "utf8").match(/as MaskedError\b/g) ?? [];
    expect(own.length).toBe(1);
  });

  test("runtime: the masked error of a duplicate key never carries the value (the brand is the masked copy)", () => {
    const raw = new DuplicateKeyError('E11000 dup key: { email: "alice@secret.example" }', {
      keyValue: { email: "alice@secret.example" },
      keyPattern: { email: 1 },
      index: "email_1",
      code: 11000,
      codeName: "DuplicateKey",
      errorLabels: [],
    });
    const masked: MaskedError = SensitiveMask.error(undefined, raw, "mask");
    /* cast: the brand is type-only — at run time it is the masked error */
    const error = masked as unknown as DuplicateKeyError;
    expect(error).not.toBe(raw);
    expect(JSON.stringify({ message: error.message, keyValue: error.keyValue })).not.toContain("alice@secret.example");
  });
});
