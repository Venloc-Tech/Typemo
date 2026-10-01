/*
 * The types of `client.currentTransaction()` and `TransactionScope.current()` (decision R65): the scope or
 * `undefined`, nothing else; neither takes arguments.
 */
import { expectTypeOf } from "expect-type";
import { TransactionScope, type TypemoClient } from "../../../src/index.ts";

declare const client: TypemoClient;

expectTypeOf(client.currentTransaction()).toEqualTypeOf<TransactionScope | undefined>();
expectTypeOf(TransactionScope.current()).toEqualTypeOf<TransactionScope | undefined>();
expectTypeOf(client.currentTransaction()?.owner).toEqualTypeOf<object | undefined>();

// @ts-expect-error currentTransaction takes no arguments (it answers for this client only)
client.currentTransaction(client);
// @ts-expect-error the answer may be undefined: read `owner` through `?.`
client.currentTransaction().owner;
// @ts-expect-error a method, not a property: call it
const inside: boolean = client.currentTransaction;
void inside;
