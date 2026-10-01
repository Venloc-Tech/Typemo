// The demo is the documentation people run first: it must run to the end and print every step.
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { NestTest } from "../support/nest-test.ts";

test("the demo application runs to the end and prints every step", async () => {
  const uri = await NestTest.uri();
  const proc = Bun.spawn(["bun", "run", "demo/main.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...process.env, MONGO_URI: uri },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(err).toBe("");
  expect(code).toBe(0);
  const lines = out.trim().split("\n");
  expect(lines).toEqual([
    '1. customer created: {"status":201,"name":"Ann"}',
    '2. accounts opened (tenant from the x-org header): ["Main","acme"]',
    '3. a savings account (discriminator): {"kind":"savings","rate":2}',
    '4. read by id with the owner populated: "Ann"',
    '5. transfer of 30 in a transaction: ["Main=70","Savings=0","Spare=30"]',
    '6. a transfer of 500 breaks min: 0 and rolls back: {"status":422,"balances":["Main=70","Savings=0","Spare=30"]}',
    '7. a malformed id: "Invalid id: expected ObjectId (not a 24-character hex string)"',
    '8. an invalid body: {"balance":"must be at least 0","color":"not a field of Account"}',
    '9. a duplicate email: {"statusCode":409,"error":"Conflict","message":"Duplicate value","fields":["email"]}',
    '10. another tenant sees only its accounts: ["Globex main"]',
    '11. @AllTenants counts every tenant: {"accounts":4}',
    "demo: done",
  ]);
}, 120_000);
