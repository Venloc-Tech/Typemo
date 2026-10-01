/*
 * On the real server: request data wrapped in `untrusted()` cannot carry an operator
 * into a filter or an update — the operation fails before anything is sent.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { type Model, StrictModeError, untrusted } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("untrusted");
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await People.create({ name: "Ann", email: "ann@x.test", tags: [], pets: [], lastSeen: null });
  t.commands.clear();
});

/** What a JSON request body parses to. */
const body = JSON.parse('{ "email": { "$ne": null }, "name": "Ann" }') as { email: string; name: string };

describe("untrusted() in operations", () => {
  test("an operator smuggled in a request body is refused; nothing is sent", async () => {
    expect(() => People.findOne({ email: untrusted(body.email) })).toThrow(StrictModeError);
    expect(() => People.updateOne({ name: untrusted(body.name) }, { $set: { email: untrusted(body.email) } })).toThrow(
      /untrusted value: "\$ne"/,
    );
    expect(t.commands.all().length).toBe(0);
  });

  test("the error names the place the value was marked for (update); nothing is sent", async () => {
    expect(() => People.updateOne({ name: "Ann" }, { $set: { email: untrusted(body.email, "update") } })).toThrow(
      /untrusted value: "\$ne" at "\$ne" — .*update operator injection.*build the update yourself/,
    );
    expect(t.commands.all().length).toBe(0);
  });

  test("a +path projection from a request cannot open a Hidden field; nothing is sent", async () => {
    /* what `?fields=...` parses to: the application believes it is harmless (the type cannot see the data) */
    const fields = JSON.parse('{ "name": 1, "+secret": true }') as { readonly name: 1 };
    expect(() => People.findOne().select(untrusted(fields, "projection"))).toThrow(
      /"\+secret".*would select a Hidden field; validate the input and build the projection yourself/,
    );
    expect(t.commands.all().length).toBe(0);
    /* the same projection written by the application itself still works (the hidden field is selected on purpose) */
    await People.updateOne({ name: "Ann" }, { $set: { secret: "s" } });
    expect((await People.findOne().select({ "+secret": true }).lean())?.secret).toBe("s");
    /* a safe projection from outside goes through */
    const safe = JSON.parse('{ "name": 1 }') as { name: 1 };
    const row = await People.findOne().select(untrusted(safe)).lean();
    expect(row?.name).toBe("Ann");
    expect(row && "secret" in row).toBe(false);
  });

  test("plain data goes through unchanged", async () => {
    expect((await People.findOne({ name: untrusted(body.name) }).lean())?.email).toBe("ann@x.test");
    expect(
      (await People.updateOne({ name: untrusted(body.name) }, { $set: { age: untrusted(3) } })).modifiedCount,
    ).toBe(1);
  });
});
