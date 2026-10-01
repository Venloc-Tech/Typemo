/*
 * Change streams on the real replica set: typed events per operation type (insert/update/replace/delete), lean
 * and hydrated documents in code names, pre/post images, resume after close (`resumeAfter`, `startAfter`),
 * `tryNext`, `for await`, discriminator streams that keep deletes, hidden fields removed, dbName
 * aliases translated both ways, and pipelines that reshape events.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  type ChangeEvent,
  ConfigurationError,
  type ModelChangeStream,
  QueryError,
  TypemoError,
} from "../../../src/index.ts";
import { AliasedDoc, Animal, Cat, Dog, Imaged } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s9_streams");

/**
 * The next `count` events.
 * @param stream The change stream.
 * @param count How many events to read.
 * @returns The events in order.
 */
const take = async <E>(stream: ModelChangeStream<E>, count: number): Promise<E[]> => {
  const out: E[] = [];
  while (out.length < count) out.push(await stream.next());
  return out;
};

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("s9_")) await t.mongo.db.dropCollection(name);
  }
  await t.connection.model(Imaged).createCollection();
  await t.connection.model(Animal).createCollection();
});

describe("typed events per operation type", () => {
  test("insert, update (with updateLookup), replace, delete — lean, code names", async () => {
    const Imageds = t.connection.model(Imaged);
    const stream = await Imageds.watch({ fullDocument: "updateLookup" });
    const doc = await Imageds.create({ name: "a", n: 1 });
    await Imageds.updateOne({ _id: doc._id }, { $set: { n: 2 } });
    /* updateLookup reads the CURRENT document when the event is read: read the update before changing more. */
    const [insert, update] = await take(stream, 2);
    await Imageds.replaceOne({ _id: doc._id }, { name: "b", n: 3 });
    await Imageds.deleteOne({ _id: doc._id });
    const [replace, remove] = await take(stream, 2);
    await stream.close();
    expect(insert?.operationType).toBe("insert");
    if (insert?.operationType === "insert") {
      expect(insert.fullDocument).toEqual({ _id: doc._id, name: "a", n: 1 });
      expect(insert.documentKey._id).toEqual(doc._id);
    }
    if (update?.operationType !== "update") throw new Error("expected an update");
    expect(update.updateDescription.updatedFields).toEqual({ n: 2 });
    expect(update.updateDescription.removedFields).toEqual([]);
    expect(update.fullDocument?.n).toBe(2);
    if (replace?.operationType !== "replace") throw new Error("expected a replace");
    expect(replace.fullDocument.name).toBe("b");
    expect(remove?.operationType).toBe("delete");
    expect(stream.closed).toBe(true);
  });

  test("pre- and post-images: fullDocumentBeforeChange of update, replace and delete", async () => {
    const Imageds = t.connection.model(Imaged);
    const stream = await Imageds.watch({ fullDocument: "required", fullDocumentBeforeChange: "required" });
    const doc = await Imageds.create({ name: "a", n: 1 });
    await Imageds.updateOne({ _id: doc._id }, { $inc: { n: 1 } });
    await Imageds.replaceOne({ _id: doc._id }, { name: "r", n: 9 });
    await Imageds.deleteOne({ _id: doc._id });
    const [, update, replace, remove] = await take(stream, 4);
    await stream.close();
    if (update?.operationType !== "update") throw new Error("expected an update");
    expect([update.fullDocumentBeforeChange.n, update.fullDocument.n]).toEqual([1, 2]);
    if (replace?.operationType !== "replace") throw new Error("expected a replace");
    expect([replace.fullDocumentBeforeChange.name, replace.fullDocument.name]).toEqual(["a", "r"]);
    if (remove?.operationType !== "delete") throw new Error("expected a delete");
    expect(remove.fullDocumentBeforeChange).toMatchObject({ name: "r", n: 9 });
  });

  test("hydrate: the documents are hydrated instances of the entity", async () => {
    const Imageds = t.connection.model(Imaged);
    const stream = await Imageds.watch({ hydrate: true });
    await Imageds.create({ name: "h", n: 1 });
    const [event] = await take(stream, 1);
    await stream.close();
    if (event?.operationType !== "insert") throw new Error("expected an insert");
    expect(event.fullDocument).toBeInstanceOf(Imaged);
    expect(event.fullDocument.$isNew()).toBe(false);
  });
});

describe("the server cursor is open when watch() resolves", () => {
  test("watch(), an immediate create(), next(): the event is delivered, every time", async () => {
    const Imageds = t.connection.model(Imaged);
    for (let round = 0; round < 25; round += 1) {
      const stream = await Imageds.watch();
      await Imageds.create({ name: `r${round}`, n: round });
      const event = await stream.next();
      await stream.close();
      expect(event.operationType === "insert" ? event.fullDocument.name : "").toBe(`r${round}`);
    }
  }, 60_000);

  test("a write made while the stream opens is buffered, not lost: tryNext and for await deliver it", async () => {
    const Imageds = t.connection.model(Imaged);
    for (let round = 0; round < 10; round += 1) {
      const pending = Imageds.watch();
      const stream = await pending;
      const write = Imageds.create({ name: `t${round}`, n: round });
      const seen: string[] = [];
      if (round % 2 === 0) {
        await write;
        let event = await stream.tryNext();
        while (event === null) event = await stream.tryNext();
        seen.push(event.operationType === "insert" ? event.fullDocument.name : "");
        await stream.close();
      } else {
        for await (const event of stream) {
          seen.push(event.operationType === "insert" ? event.fullDocument.name : "");
          break;
        }
        await write;
      }
      expect(seen).toEqual([`t${round}`]);
      expect(stream.closed).toBe(true);
    }
  }, 60_000);

  test("a pipeline stream (Pipeline.watch stages) is open too", async () => {
    const Imageds = t.connection.model(Imaged);
    for (let round = 0; round < 10; round += 1) {
      const stream = await Imageds.watch((p) => p.match({ operationType: "insert" }));
      await Imageds.create({ name: `p${round}`, n: round });
      const event = await stream.next();
      await stream.close();
      expect(event.operationType === "insert" ? event.fullDocument.name : "").toBe(`p${round}`);
    }
  }, 60_000);

  test("close() right after watch() is harmless; the resume token is known before the first event", async () => {
    const Imageds = t.connection.model(Imaged);
    const stream = await Imageds.watch();
    expect(stream.resumeToken).toBeDefined();
    await stream.close();
    expect(stream.closed).toBe(true);
  });

  test("a stream the server refuses fails in watch(), not in the first read", async () => {
    const Imageds = t.connection.model(Imaged);
    const error = await Imageds.watch({ resumeAfter: { _data: "00" } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypemoError);
  });
});

describe("stream control", () => {
  test("tryNext is null when nothing happened; for await ends on close()", async () => {
    const Imageds = t.connection.model(Imaged);
    const stream = await Imageds.watch();
    expect(await stream.tryNext()).toBeNull();
    const seen: string[] = [];
    const loop = (async () => {
      for await (const event of stream) {
        seen.push(event.operationType);
        if (seen.length === 1) await stream.close();
      }
    })();
    await Imageds.create({ name: "x", n: 1 });
    await loop;
    expect(seen).toEqual(["insert"]);
    expect(stream.closed).toBe(true);
  });

  test("resume after close: resumeAfter and startAfter continue after the last event read", async () => {
    const Imageds = t.connection.model(Imaged);
    const first = await Imageds.watch();
    await Imageds.create({ name: "one", n: 1 });
    const [one] = await take(first, 1);
    const token = first.resumeToken;
    await first.close();
    await Imageds.create({ name: "two", n: 2 });
    await Imageds.create({ name: "three", n: 3 });
    const resumed = await Imageds.watch({ resumeAfter: token });
    const names = (await take(resumed, 2)).map((event) =>
      event.operationType === "insert" ? event.fullDocument.name : "",
    );
    await resumed.close();
    expect(one?.operationType).toBe("insert");
    expect(names).toEqual(["two", "three"]);
    const started = await Imageds.watch({ startAfter: token });
    const [again] = await take(started, 1);
    await started.close();
    expect(again?.operationType === "insert" ? again.fullDocument.name : "").toBe("two");
  });

  test("an unknown option is refused", async () => {
    const error = await t.connection
      .model(Imaged)
      .watch({ fullDocument: "updateLookup", resumeToken: "x" } as never)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
  });

  test("option values are checked at run time: wrong types and a zero batch size are refused", async () => {
    const Imageds = t.connection.model(Imaged);
    const refused = async (options: unknown): Promise<unknown> =>
      Imageds.watch(options as never).catch((caught: unknown) => caught);
    for (const [options, text] of [
      [{ hydrate: "x" }, 'watch: hydrate must be a boolean, got "x" (string)'],
      [{ fullDocument: "always" }, "watch: fullDocument must be one of"],
      [{ fullDocumentBeforeChange: true }, "watch: fullDocumentBeforeChange must be one of"],
      [{ showExpandedEvents: 1 }, "watch: showExpandedEvents must be a boolean, got 1 (number)"],
      [{ batchSize: 0 }, "watch: batchSize must be a positive integer"],
      [{ batchSize: "5" }, 'got "5" (string)'],
      [{ maxAwaitTimeMS: 0 }, "watch: maxAwaitTimeMS must be a positive integer"],
      [{ resumeAfter: "token" }, "watch: resumeAfter must be a resume token"],
      [{ startAtOperationTime: 5 }, "watch: startAtOperationTime must be a Timestamp"],
    ] as const) {
      const error = await refused(options);
      expect(error).toBeInstanceOf(QueryError);
      expect((error as QueryError).message).toContain(text);
    }
    const stream = await Imageds.watch({ hydrate: false, batchSize: 10, maxAwaitTimeMS: 50 });
    await stream.close();
  });
});

describe("discriminators: deletes are never lost", () => {
  test("without images: the Dog stream sees its inserts only, and every delete (the server cannot tell the class)", async () => {
    const Dogs = t.connection.model(Dog);
    const Cats = t.connection.model(Cat);
    const stream = await Dogs.watch();
    const dog = await Dogs.create({ name: "rex", barks: true });
    const cat = await Cats.create({ name: "tom", lives: 9 });
    await Cats.deleteOne({ _id: cat._id });
    await Dogs.deleteOne({ _id: dog._id });
    const events = await take(stream, 3);
    await stream.close();
    expect(events.map((event) => event.operationType)).toEqual(["insert", "delete", "delete"]);
    const [insert] = events;
    if (insert?.operationType !== "insert") throw new Error("expected an insert");
    expect(insert.fullDocument).toMatchObject({ name: "rex", barks: true, __t: "dog" });
  });

  test("with pre-images: the deletes of other classes are filtered out on the server", async () => {
    const Dogs = t.connection.model(Dog);
    const Cats = t.connection.model(Cat);
    const stream = await Dogs.watch({ fullDocumentBeforeChange: "whenAvailable" });
    const dog = await Dogs.create({ name: "rex", barks: true });
    const cat = await Cats.create({ name: "tom", lives: 9 });
    await Cats.deleteOne({ _id: cat._id });
    await Dogs.updateOne({ _id: dog._id }, { $set: { barks: false } });
    await Dogs.deleteOne({ _id: dog._id });
    const events = await take(stream, 3);
    expect(await stream.tryNext()).toBeNull();
    await stream.close();
    expect(
      events.map((event) => [event.operationType, "documentKey" in event ? String(event.documentKey._id) : ""]),
    ).toEqual([
      ["insert", String(dog._id)],
      ["update", String(dog._id)],
      ["delete", String(dog._id)],
    ]);
  });

  test("the root model's stream sees every class; lean documents keep their key", async () => {
    const Animals = t.connection.model(Animal);
    const stream = await Animals.watch();
    await t.connection.model(Dog).create({ name: "rex", barks: true });
    await t.connection.model(Cat).create({ name: "tom", lives: 9 });
    const events = await take(stream, 2);
    await stream.close();
    expect(events.map((event) => (event.operationType === "insert" ? event.fullDocument.name : ""))).toEqual([
      "rex",
      "tom",
    ]);
  });
});

describe("hidden fields and dbName aliases", () => {
  test("a Hidden field is removed from documents and update descriptions", async () => {
    const Animals = t.connection.model(Animal);
    const stream = await Animals.watch({ fullDocument: "updateLookup" });
    const animal = await Animals.create({ name: "a", secret: "s1" });
    await Animals.updateOne({ _id: animal._id }, { $set: { secret: "s2", name: "b" } });
    const [insert, update] = await take(stream, 2);
    await stream.close();
    expect(insert?.operationType === "insert" && "secret" in insert.fullDocument).toBe(false);
    if (update?.operationType !== "update") throw new Error("expected an update");
    expect(update.updateDescription.updatedFields).toEqual({ name: "b" });
    expect(update.fullDocument !== null && "secret" in (update.fullDocument ?? {})).toBe(false);
  });

  test("include keeps a hidden field in documents and update descriptions (typed), lean and hydrated", async () => {
    const Animals = t.connection.model(Animal);
    const stream = await Animals.watch({ fullDocument: "updateLookup", include: ["secret"] });
    const animal = await Animals.create({ name: "a", secret: "s1" });
    await Animals.updateOne({ _id: animal._id }, { $set: { secret: "s2" } });
    const [insert, update] = await take(stream, 2);
    await stream.close();
    if (insert?.operationType !== "insert" || update?.operationType !== "update")
      throw new Error("expected insert, update");
    const secret: string | undefined = insert.fullDocument.secret; /* in the type: included */
    expect(secret).toBe("s1");
    expect(update.updateDescription.updatedFields).toEqual({ secret: "s2" });
    expect(update.fullDocument?.secret).toBe("s2");
    const hydrated = await Animals.watch({ hydrate: true, include: ["secret"] });
    await Animals.create({ name: "h", secret: "s3" });
    const [event] = await take(hydrated, 1);
    await hydrated.close();
    expect(event?.operationType === "insert" && event.fullDocument.secret).toBe("s3");
  });

  test("include of a path that is not hidden is an error (typed and at run time)", async () => {
    const Animals = t.connection.model(Animal);
    // @ts-expect-error — "name" is not a Hidden path of Animal
    await expect(Animals.watch({ include: ["name"] })).rejects.toBeInstanceOf(QueryError);
    await expect(Animals.watch({ include: "secret" as never })).rejects.toBeInstanceOf(QueryError);
  });

  test("aliases: $match on code paths is translated; events come back in code names", async () => {
    const Aliased = t.connection.model(AliasedDoc);
    await Aliased.createCollection();
    const stream = await Aliased.watch((p) => p.match({ "fullDocument.title": "keep" }), {
      fullDocument: "updateLookup",
    });
    await Aliased.create({ title: "drop", count: 1 });
    const kept = await Aliased.create({ title: "keep", count: 1, address: { city: "Oslo" } });
    await Aliased.updateOne({ _id: kept._id }, { $set: { "address.city": "Bergen", count: 2 } });
    const [insert, update] = await take(stream, 2);
    await stream.close();
    if (insert?.operationType !== "insert") throw new Error("expected an insert");
    expect(insert.fullDocument).toEqual({ _id: kept._id, title: "keep", count: 1, address: { city: "Oslo" } });
    if (update?.operationType !== "update") throw new Error("expected an update");
    expect(update.updateDescription.updatedFields).toEqual({ "address.city": "Bergen", count: 2 });
  });

  test("aliases: a stage other than $match is refused (it would not be translated)", async () => {
    const error = await t.connection
      .model(AliasedDoc)
      .watch((p) => p.project({ operationType: 1 }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
  });
});

describe("pipelines that reshape events", () => {
  test("$project: the rows are the pipeline's own; hydrate with such a pipeline is refused", async () => {
    const Imageds = t.connection.model(Imaged);
    const stream = await Imageds.watch((p) => p.project({ operationType: 1, documentKey: 1 }));
    const doc = await Imageds.create({ name: "p", n: 1 });
    const [row] = await take(stream, 1);
    await stream.close();
    expect(row).toMatchObject({ operationType: "insert", documentKey: { _id: doc._id } });
    expect(row && "fullDocument" in row).toBe(false);
    const error = await Imageds.watch((p) => p.project({ operationType: 1 }), { hydrate: true }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(QueryError);
  });
});

/** A value of the public event type (compile-time use). */
export type _Events = ChangeEvent<Imaged>;
