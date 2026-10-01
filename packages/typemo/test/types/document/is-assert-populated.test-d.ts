/*
 * `doc.$is(Class)` narrows a document of a base model to a discriminator class, so the class's own paths can be
 * populated; `doc.$assertPopulated(path)` gives the document typed with the path populated (a populate the type
 * cannot see, e.g. done by a hook).
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import type { HydratedDoc, ModelOperations, Ref } from "../../../src/index.ts";
import {
  type Company,
  Event,
  type Person,
  type Product,
  Purchase,
  Signup,
} from "../../fixtures/populate/populate-entities.ts";

declare const Events: ModelOperations<Event>;
declare const People: ModelOperations<Person>;

// ---- $is --------------------------------------------------------------------------------------------------
declare const event: Awaited<ReturnType<typeof readEvent>>;
const readEvent = () => Events.findOne().orFail();

// @ts-expect-error — `user` is a field of Signup only: not on a document of the base model
event.user;
if (event.$is(Signup)) {
  // narrowed: the discriminator's own field and its key literal
  expectTypeOf(event.user).toEqualTypeOf<Ref<Person>>();
  expectTypeOf(event.__t).toEqualTypeOf<"signup">();
  // …and its paths can be populated (without a cast)
  const populated = async () => (await event.$populate("user")).user;
  expectTypeOf<Awaited<ReturnType<typeof populated>>>().toEqualTypeOf<HydratedDoc<Person> | null>();
}
if (event.$is(Purchase)) expectTypeOf(event.product).toEqualTypeOf<Ref<Product>>();
// the root class itself is accepted (always true for a document of the hierarchy)
if (event.$is(Event)) expectTypeOf(event.label).toEqualTypeOf<string>();
// @ts-expect-error — `$is` takes a class, not a discriminator value
event.$is("signup");

// ---- $assertPopulated -----------------------------------------------------------------------------------

declare const person: Awaited<ReturnType<typeof readPerson>>;
const readPerson = () => People.findOne().orFail();

expectTypeOf(person.company).toEqualTypeOf<Ref<Company> | undefined>();
const withCompany = person.$assertPopulated("company");
expectTypeOf(withCompany.company).toEqualTypeOf<HydratedDoc<Company> | null | undefined>();
expectTypeOf<NonNullable<typeof withCompany.company>["$save"]>().toBeFunction(); // a document of the Company model
const friends = person.$assertPopulated("friends");
expectTypeOf(friends.friends).toEqualTypeOf<readonly HydratedDoc<Person>[]>();
// the options the populate used type the populated form
const selected = person.$assertPopulated({ path: "company", select: { name: 1 } });
expectTypeOf(selected.company?.name).toEqualTypeOf<string | undefined>();
// @ts-expect-error — not selected: absent from the asserted form
selected.company?.size;
// nested: a dotted path through references
const mentorCompany = person.$assertPopulated("mentor.company");
expectTypeOf(mentorCompany.mentor?.company).toEqualTypeOf<HydratedDoc<Company> | null | undefined>();
// @ts-expect-error — "name" is not a reference: the same readable error as populate()
person.$assertPopulated("name");
// @ts-expect-error — an unknown path
person.$assertPopulated("compny");

// the id stays typed
expectTypeOf(withCompany._id).toEqualTypeOf<ObjectId>();

// ---- $assertPopulated with a list: the same list $populate takes -----------------------------------------
const both = person.$assertPopulated(["company", "friends"]);
expectTypeOf(both.company).toEqualTypeOf<HydratedDoc<Company> | null | undefined>();
expectTypeOf(both.friends).toEqualTypeOf<readonly HydratedDoc<Person>[]>();
const mixed = person.$assertPopulated(["company", { path: "friends", select: { name: 1 } }]);
expectTypeOf(mixed.friends[0]?.name).toEqualTypeOf<string | undefined>();
// @ts-expect-error — not selected for the friends: absent from the asserted form
mixed.friends[0]?.age;
// @ts-expect-error — "name" is not a reference: the list elements are checked like populate()
person.$assertPopulated(["company", "name"]);
// @ts-expect-error — a path given twice
person.$assertPopulated(["company", { path: "company" }]);
