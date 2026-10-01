/*
 * Typed usage through the built declarations. The file only has to compile (nothing here runs): filters, updates,
 * lean/plain/select/populate results, create inputs, aggregation rows, errors, hooks, the testing entry and the
 * adapters entry.
 */
import {
  CastError,
  type CreateInput,
  fn,
  type HydratedDoc,
  type Lean,
  type Model,
  Pipeline,
  type Plain,
  PolicyContext,
  QueryError,
  type TypemoClient,
  ValidationError,
} from "@venloc/typemo";
import { MetadataBuilder } from "@venloc/typemo/adapters";
import { defineFactory } from "@venloc/typemo/testing";
import { Circle, Country, Note, Order, User } from "./entities.js";

/** Type equality used by the assertions below. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** Fails to compile unless `T` is `true`. */
type Expect<T extends true> = T;

/**
 * Exercises the API.
 *
 * @param client - a client that is never connected
 * @returns values whose types are checked
 */
export const usage = async (client: TypemoClient) => {
  const Users: Model<User> = client.connection.model(User);
  const Orders = client.connection.model(Order);
  const Countries = client.connection.model(Country);
  const Notes = client.connection.model(Note);
  const Circles = client.connection.model(Circle);

  await Users.updateOne({ email: "a@x.io" }, { $inc: { age: 1 }, $push: { tags: "new" } });
  const lean = await Users.find({ tags: { $in: ["a"] }, age: { $gte: 18 } })
    .sort({ name: 1 })
    .lean();
  type _lean = Expect<Equal<(typeof lean)[number]["name"], string>>;
  const picked = await Users.find().select({ name: 1 }).lean();
  type _picked = Expect<Equal<(typeof picked)[number]["name"], string>>;
  const populated = await Users.findOne({ name: "a" }).populate("region").orFail().lean();
  const regionName: string | undefined = populated.region?.name;
  const plain: Plain<User> = await Users.findOne({}).orFail().plain();
  const created: HydratedDoc<User> = await Users.create({ name: "a", email: "a@x.io", tags: [] });
  const input: CreateInput<User> = { name: "a", email: "a@x.io", tags: [] };
  type _input = Expect<Equal<typeof input.name, string>>;
  const asLean: Lean<User> = await Users.findById(created._id).orFail().lean();

  const rows = await Orders.aggregate((p) => p.group((f) => ({ _id: f.status, total: fn.sum(f.amount) })));
  type _rows = Expect<Equal<(typeof rows)[number]["total"], number>>;
  const plan = Pipeline.from(Order)
    .match({ amount: { $gt: 1 } })
    .plan();
  const byId = await Countries.findById("FR");
  const id: string | undefined = byId?._id;
  const note = await PolicyContext.run({ tenant: "t" }, () => Notes.create({ text: "x" }));
  const tenant: string = note.tenantId;
  const circle = await Circles.create({ radius: 2 });
  const radius: number = circle.radius;

  const factory = defineFactory(Users, (n) => ({ name: `f${n}`, email: `f${n}@x.io`, tags: [] }));
  const built = factory.build();

  try {
    await Users.create({ name: "x" } as never);
  } catch (error) {
    if (error instanceof ValidationError) void error.issues;
    if (error instanceof CastError || error instanceof QueryError) void error.message;
  }
  void MetadataBuilder;
  return { lean, picked, regionName, plain, asLean, rows, plan, id, tenant, radius, built };
};
