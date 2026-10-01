/*
 * Builder methods inside another generic call, and arguments typed `any`.
 *
 * A builder method called inside a generic call (`expect(() => Members.find().select({ name: 1 }))`) compiled with
 * TS2589 ("excessively deep") before the builder's type parameters were declared invariant: the compiler compared
 * two builders member by member. `select(any)` gives the widest honest result (every field optional: the
 * projection may leave any field out); `populate(any)` gives a readable error (which paths it populates is
 * unknown). Every `@ts-expect-error` says what must fail.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { PathError } from "../../../src/types/paths.ts";
import { Members } from "./setup.ts";

/** A generic call around a builder, as `expect(() => …)` of a test runner. */
declare const around: <V>(value: V) => V;
/** A value typed `any`, as a request body of a framework without types. */
// biome-ignore lint/suspicious/noExplicitAny: the subject of the test is an argument typed any
declare const untyped: any;

/* ---- a builder method inside another generic call ---- */
around(() => Members.find().select({ name: 1 }));
around(() => Members.find().populate("bestFriend"));
around(() => Members.find().populate(["bestFriend"]));
around(() => Members.find().select({ name: 1 }).populate("bestFriend").lean());
around(async () => await Members.find().select({ name: 1 }).lean());

/* ---- select(any): every field optional, no `any` in the result ---- */
around(() => Members.find().select(untyped));
const wide = Members.findOne().select(untyped).lean().orFail();
type WideRow = Awaited<typeof wide>;
expectTypeOf<WideRow["name"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<WideRow>().not.toBeAny();
// @ts-expect-error a projection of unknown shape may leave `name` out: it is optional, not a string
export const name: string = ({} as WideRow).name;

/* ---- populate(any): a readable error, before any check runs ---- */
around(() => Members.find().populate(untyped));
const populated = Members.find().populate(untyped);
expectTypeOf(populated).toEqualTypeOf<
  PathError<"populate(): the argument is typed any; give it a type (a path literal, a list of paths or a populate object)">
>();
// @ts-expect-error the result of populate(any) is an error, not a builder: it has no lean()
populated.lean();

/* ---- the typed forms keep their checks ---- */
// @ts-expect-error "nope" is not a path of Member (the list check still runs for a typed list)
Members.find().populate(["nope"]);
// @ts-expect-error "nope" is not a path of Member (the single-path check)
Members.find().populate("nope");
