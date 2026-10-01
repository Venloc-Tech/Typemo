/*
 * `required: true` + `nullable: true`: the key is required, `null` is a value — create, save, updates (operators and
 * a pipeline) and an upsert agree. Real server.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, fn, type Model, Prop, Schema, ValidationError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A contact whose phone must be given, possibly as `null`. */
@Schema({ collection: "f100_contacts" })
class Contact extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true, nullable: true }) phone!: string | null;
}

const t = ModelLifecycle.useTypemo("f100_required_nullable");
let Contacts: Model<Contact>;
const raw = () => t.mongo.db.collection("f100_contacts");

beforeEach(async () => {
  Contacts = t.connection.model(Contact);
  await raw().deleteMany({});
});

describe("required + nullable", () => {
  test("create takes null and stores it; a missing key is a ValidationError", async () => {
    const contact = await Contacts.create({ name: "ann", phone: null });
    expect((await raw().findOne({ _id: contact._id }))?.phone).toBeNull();
    /* cast: the key left out on purpose — the type requires it */
    await expect(Contacts.create({ name: "bob" } as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(Contacts.create({ name: "bob" } as never)).rejects.toThrow(/"phone": the field is required/);
  });

  test("save: an assigned null passes", async () => {
    const contact = await Contacts.create({ name: "ann", phone: "1" });
    contact.phone = null;
    await contact.$save();
    expect((await raw().findOne({ _id: contact._id }))?.phone).toBeNull();
  });

  test("updates: $set null passes, $unset is refused; a pipeline $set of null passes", async () => {
    const contact = await Contacts.create({ name: "ann", phone: "1" });
    await Contacts.updateOne({ _id: contact._id }, { $set: { phone: null } });
    expect((await raw().findOne({ _id: contact._id }))?.phone).toBeNull();
    /* cast: $unset of a required key on purpose — the type refuses it too */
    await expect(Contacts.updateOne({ _id: contact._id }, { $unset: { phone: "" } } as never).exec()).rejects.toThrow(
      /the field is required/,
    );
    await Contacts.updateOne({ _id: contact._id }, (p) => p.set(() => ({ phone: fn.literal("2") })));
    await Contacts.updateOne({ _id: contact._id }, (p) => p.set(() => ({ phone: fn.literal(null) })));
    expect((await raw().findOne({ _id: contact._id }))?.phone).toBeNull();
  });

  test("an upsert needs the key; null is enough", async () => {
    await Contacts.updateOne({ name: "cid" }, { $set: { phone: null } }, { upsert: true });
    expect((await raw().findOne({ name: "cid" }))?.phone).toBeNull();
    await expect(
      Contacts.updateOne({ name: "dan" }, { $set: { name: "dan" } }, { upsert: true }).exec(),
    ).rejects.toThrow(/required field "phone"/);
  });
});
