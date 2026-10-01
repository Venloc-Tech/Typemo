/*
 * The data set of the populate tests: known ids, a dangling reference of every kind (an id with
 * no document; populate keeps it), written through the models (so casting and dbName apply) except where a raw
 * stored shape is needed.
 */
import { ObjectId, UUID } from "mongodb";
import type { TypemoTestContext } from "../model/model-lifecycle.ts";
import {
  Activity,
  Canvas,
  Comment,
  Company,
  Device,
  Event,
  Order,
  Person,
  Post,
  Product,
  Purchase,
  Reading,
  Signup,
  Tag,
} from "./populate-entities.ts";

/** Fixed ids of the data set. */
export const P = {
  acme: new ObjectId(),
  globex: new ObjectId(),
  red: new ObjectId(),
  blue: new ObjectId(),
  ann: new ObjectId(),
  bob: new ObjectId(),
  cid: new ObjectId(),
  dan: new ObjectId(),
  p1: new ObjectId(),
  p2: new ObjectId(),
  p3: new ObjectId(),
  p4: new ObjectId(),
  c1: new ObjectId(),
  c2: new ObjectId(),
  c3: new ObjectId(),
  pen: new ObjectId(),
  ink: new ObjectId(),
  o1: new ObjectId(),
  /** An order whose every reference has its document (shape tests: a found reference is typed without `null`). */
  o2: new ObjectId(),
  a1: new ObjectId(),
  a2: new ObjectId(),
  canvas: new ObjectId(),
  device: new ObjectId(),
  /** Ids no document has (dangling references). */
  gone: new ObjectId(),
  goneTag: new ObjectId(),
  goneProduct: new ObjectId(),
  goneCompany: new ObjectId(),
  s1: new UUID(),
  s2: new UUID(),
  s3: new UUID(),
} as const;

/**
 * The models of the populate graph on a test connection.
 *
 * @param t - the test context that owns the connection
 * @returns one model per entity of the graph, keyed by plural name
 */
export const populateModels = (t: TypemoTestContext) => {
  const c = t.connection;
  return {
    Companies: c.model(Company),
    Tags: c.model(Tag),
    People: c.model(Person),
    Posts: c.model(Post),
    Comments: c.model(Comment),
    Products: c.model(Product),
    Orders: c.model(Order),
    Activities: c.model(Activity),
    Events: c.model(Event),
    Signups: c.model(Signup),
    Purchases: c.model(Purchase),
    Canvases: c.model(Canvas),
    Devices: c.model(Device),
    Readings: c.model(Reading),
  };
};

/**
 * The models object returned by `populateModels`.
 *
 * @example
 * const people: PopulateModels["People"] = populateModels(t).People;
 */
export type PopulateModels = ReturnType<typeof populateModels>;

/**
 * Clears the collections and writes the data set.
 *
 * @param t - the test context that owns the connection
 * @returns the models of the populate graph
 */
export const seedPopulate = async (t: TypemoTestContext): Promise<PopulateModels> => {
  const m = populateModels(t);
  const db = t.mongo.db;
  for (const name of [
    "pp_companies",
    "pp_tags",
    "pp_people",
    "pp_posts",
    "pp_comments",
    "pp_products",
    "pp_orders",
    "pp_activities",
    "pp_events",
    "pp_canvases",
    "pp_devices",
    "pp_readings",
  ]) {
    await db.collection(name).deleteMany({});
  }
  await m.Companies.insertMany([
    { _id: P.acme, name: "acme", size: 10, secret: "s1" },
    { _id: P.globex, name: "globex", size: 20 },
  ]);
  await m.Tags.insertMany([
    { _id: P.red, label: "red" },
    { _id: P.blue, label: "blue" },
  ]);
  await m.People.insertMany([
    {
      _id: P.ann,
      name: "ann",
      age: 30,
      company: P.acme,
      mentor: null,
      friends: [P.bob, P.gone, P.cid],
      tagsByTopic: { color: P.red, mood: P.goneTag },
    },
    { _id: P.bob, name: "bob", age: 40, company: P.globex, mentor: P.ann, friends: [] },
    { _id: P.cid, name: "cid", friends: [P.ann] },
    { _id: P.dan, name: "dan", company: P.goneCompany, friends: [] },
  ]);
  await m.Posts.insertMany([
    { _id: P.p1, title: "one", author: P.ann, tags: [P.red, P.blue], views: 10, published: true },
    { _id: P.p2, title: "two", author: P.ann, tags: [P.blue], views: 30, published: false },
    { _id: P.p3, title: "three", author: P.ann, tags: [], views: 20, published: true },
    { _id: P.p4, title: "four", author: P.bob, tags: [P.red], views: 5, published: true },
  ]);
  await m.Comments.insertMany([
    { _id: P.c1, body: "c1", post: P.p1, author: P.bob },
    { _id: P.c2, body: "c2", post: P.p1, author: P.cid },
    { _id: P.c3, body: "c3", post: P.p4, author: P.ann },
  ]);
  await m.Products.insertMany([
    { _id: P.pen, name: "pen", price: 1 },
    { _id: P.ink, name: "ink", price: 2 },
  ]);
  await m.Orders.insertMany([
    {
      _id: P.o1,
      customer: P.ann,
      lines: [
        { product: P.pen, qty: 2 },
        { product: P.goneProduct, qty: 9 },
        { product: P.ink, qty: 1 },
      ],
      shipping: { city: "Paris", carrier: P.acme },
      extras: { gift: P.ink, lost: P.goneProduct },
      notes: { first: { text: "hello", author: P.bob }, second: { text: "anonymous" } },
    },
  ]);
  await m.Orders.insertOne({
    _id: P.o2,
    customer: P.bob,
    lines: [{ product: P.ink, qty: 3 }],
    shipping: { city: "Rome", carrier: P.globex },
    extras: { gift: P.pen },
    notes: { only: { text: "hi", author: P.ann } },
  });
  await m.Activities.insertMany([
    { _id: P.a1, kind: "Post", target: P.p1, subject: P.p2 },
    { _id: P.a2, kind: "Comment", target: P.c1, subject: P.c3 },
  ]);
  await m.Signups.insertOne({ label: "join", user: P.ann });
  await m.Purchases.insertOne({ label: "buy", product: P.pen });
  await m.Canvases.insertOne({
    _id: P.canvas,
    name: "art",
    shapes: [
      { kind: "circle", radius: 1, owner: P.bob },
      { kind: "square", side: 2 },
      { kind: "circle", radius: 3, owner: P.gone },
    ],
  });
  await m.Readings.insertMany([
    { serial: P.s1, value: 1 },
    { serial: P.s2, value: 2 },
    { serial: P.s3, value: 3 },
  ]);
  await m.Devices.insertOne({ _id: P.device, serials: [P.s1, P.s3] });
  t.commands.clear();
  return m;
};
