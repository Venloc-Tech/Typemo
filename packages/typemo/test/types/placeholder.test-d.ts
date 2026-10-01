/*
 * Placeholder type test so `tsconfig.test.json`'s `include` glob always has at least one file to compile.
 */
import { expectTypeOf } from "expect-type";
import { VERSION } from "../../src/index.ts";

expectTypeOf(VERSION).toEqualTypeOf<string>();
