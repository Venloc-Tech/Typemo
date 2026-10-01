/*
 * `EntityWithId`: the type of `_id` follows the spec, `IdOf` and the operations that take an id follow it, and the
 * id is optional in `create` exactly when the base has a `default`. Every `@ts-expect-error` says what must fail.
 */
import { expectTypeOf } from "expect-type";
import type { UUID } from "mongodb";
import type { CreateInput, IdOf, Lean, Model } from "../../../src/index.ts";
import type { Counter, Country, Session, Tag } from "../../fixtures/model/id-entities.ts";

declare const Countries: Model<Country>;
declare const Sessions: Model<Session>;
declare const Counters: Model<Counter>;
declare const Tags: Model<Tag>;

/* The id type follows the spec. */
expectTypeOf<IdOf<Country>>().toEqualTypeOf<string>();
expectTypeOf<IdOf<Session>>().toEqualTypeOf<UUID>();
expectTypeOf<IdOf<Counter>>().toEqualTypeOf<number>();
expectTypeOf<IdOf<Tag>>().toEqualTypeOf<string>();

/* Required without a default, optional with one. */
expectTypeOf<{ _id: string; name: string }>().toExtend<CreateInput<Country>>();
expectTypeOf<{ name: string }>().not.toExtend<CreateInput<Country>>();
expectTypeOf<{ user: string }>().toExtend<CreateInput<Session>>();
expectTypeOf<{ label: string }>().toExtend<CreateInput<Tag>>();
expectTypeOf<{ _id: number }>().toExtend<CreateInput<Counter>>();
expectTypeOf<{ hits: number }>().not.toExtend<CreateInput<Counter>>();

/* Reads and writes by id take the id's own type. */
Countries.findById("FR");
/* A declared value stands in for a UUID: the call is only type-checked. */
Sessions.findById(undefined as unknown as UUID);
Counters.findById(3);
// @ts-expect-error a number is not the id of a string-id model
Countries.findById(3);
// @ts-expect-error a string is not the id of a number-id model
Counters.findById("three");

/* The lean form carries the id type. */
expectTypeOf<Lean<Country>["_id"]>().toEqualTypeOf<string>();
expectTypeOf<Lean<Counter>["_id"]>().toEqualTypeOf<number>();

/* The mixins compose: the timestamps and the version come with the UUID id. */
expectTypeOf<Session["createdAt"]>().toExtend<Date>();
expectTypeOf<Session["__v"]>().toExtend<number>();

/* The id is immutable in an update. */
// @ts-expect-error `_id` cannot be updated
Countries.updateOne({ _id: "FR" }, { $set: { _id: "XX" } });
Tags.find();
