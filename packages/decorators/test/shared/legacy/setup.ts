/*
 * Preload of the runner: (1) registers THIS runner's decorators for the shared scenarios (scenarios/
 * active-decorators.ts) — a Bun plugin cannot remap a bare specifier in `bun test`, and Bun resolves `paths` from
 * the tsconfig nearest to the importing file; (2) stops the process-wide shared mongod once after the run.
 */
import { afterAll } from "bun:test";
import { MongoHarness } from "../../../../test-kit/src/index.ts";
import * as decorators from "./decorators.ts";

(globalThis as Record<symbol, unknown>)[Symbol.for("typemo.shared.decorators")] = decorators;

afterAll(async () => {
  await MongoHarness.stop();
});
