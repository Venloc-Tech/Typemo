/*
 * Runner of the shared suite in legacy mode. Not a *.test.ts on purpose: it must start from THIS folder so Bun
 * applies this folder's tsconfig (decorator mode + the @typemo-shared/decorators alias).
 */
import { SharedSuite } from "../scenarios/shared-suite.ts";

SharedSuite.register("legacy");
