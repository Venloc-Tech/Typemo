/*
 * The members only the core calls are not in the public type of the client and the connection: a tag in a
 * comment does not hide them, because users read the declaration files.
 */
import { expectTypeOf } from "expect-type";
import type { Connection, ErrorKind, TypemoClient, Untrusted } from "../../../src/index.ts";

/* Not keys of the public types. */
expectTypeOf<"auditTransaction">().not.toExtend<keyof TypemoClient>();
expectTypeOf<"extensions">().not.toExtend<keyof TypemoClient>();
expectTypeOf<"readyIfNeeded">().not.toExtend<keyof TypemoClient>();
expectTypeOf<"linksDriverCommands">().not.toExtend<keyof TypemoClient>();
expectTypeOf<"compileContext">().not.toExtend<keyof Connection>();

declare const client: TypemoClient;
declare const connection: Connection;

// @ts-expect-error auditTransaction is not a member of TypemoClient
client.auditTransaction;
// @ts-expect-error extensions is not a member of TypemoClient
client.extensions;
// @ts-expect-error readyIfNeeded is not a member of TypemoClient
client.readyIfNeeded;
// @ts-expect-error linksDriverCommands is not a member of TypemoClient
client.linksDriverCommands;
// @ts-expect-error compileContext is not a member of Connection
connection.compileContext;

/* `Untrusted.check` takes the value and the place only: the recursion's path and seen-set are private. */
expectTypeOf<Parameters<typeof Untrusted.check>["length"]>().toEqualTypeOf<1 | 2>();
// @ts-expect-error the path and the visited set of the recursion are not parameters
Untrusted.check({ a: 1 }, "update", "root", new WeakSet());

/* The kinds of the errors that were `other` before. */
expectTypeOf<"post-hook" | "audit" | "each-async">().toExtend<ErrorKind>();

/* The documented members stay. */
expectTypeOf<"use">().toExtend<keyof TypemoClient>();
expectTypeOf<"ready">().toExtend<keyof TypemoClient>();
expectTypeOf<"model">().toExtend<keyof Connection>();
