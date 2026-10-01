/*
 * The hover and type-error cases of the dist consumer: code written as a user writes it (imports from the package
 * names, the consumer's own entities), the `// ^?` marker under the name whose hover is read. The suite runs every case
 * against the BUILT declarations and against the sources and requires the same text.
 */

/** The imports and declarations every case starts with. */
export const HEAD = `
import { Entity, fn, Pipeline, Prop, Schema, type CreateInput, type HydratedDoc, type Lean, type Model, type Plain, type TypemoClient, type UpdateInput, ValidationError } from "@venloc/typemo";
import { Circle, Country, Note, Order, Region, Shape, User } from "./entities.js";
declare const client: TypemoClient;
declare const Users: Model<User>;
declare const Orders: Model<Order>;
declare const Countries: Model<Country>;
declare const Circles: Model<Circle>;
declare const doc: HydratedDoc<User>;
`;

/** One hover case: a name and the snippet after {@link HEAD}. */
export interface HoverCase {
  /** What the case shows. */
  readonly name: string;
  /** The snippet, with one `// ^?` marker. */
  readonly code: string;
  /**
   * Fragments the hover must contain. The hover itself is compared exactly between the built declarations and the
   * sources; the fragments only make sure both are not wrong in the same way.
   */
  readonly contains: readonly string[];
}

/** The hover cases. */
export const HOVER_CASES: readonly HoverCase[] = [
  {
    name: "@venloc/typemo-nestjs: a feature entry and the id pipe",
    code: `import { ParseIdPipe } from "@venloc/typemo-nestjs";\nconst pipe = ParseIdPipe.for(Country);\n//    ^?`,
    contains: ["Type<ParseIdPipe<Country>>"],
  },
  {
    name: "find().lean(): rows of the lean form",
    code: `const rows = await Users.find({ age: { $gte: 1 } }).lean();\n//    ^?`,
    contains: ["name: string", "_id: ObjectId", "createdAt: Date"],
  },
  {
    name: "findOne().populate().orFail().lean()",
    code: `const one = await Users.findOne({ name: "a" }).populate("region").orFail().lean();\n//    ^?`,
    contains: ["region?: {", "name: string"],
  },
  {
    name: "select({ name: 1 }).lean()",
    code: `const picked = await Users.find().select({ name: 1 }).lean();\n//    ^?`,
    contains: ["{ name: string; _id: ObjectId; }[]"],
  },
  {
    name: "plain(): the plain form of one document",
    code: `const plain = await Users.findOne().orFail().plain();\n//    ^?`,
    contains: ["_id: string", "region?: string"],
  },
  {
    name: "CreateInput of an entity with timestamps, a reference and defaults",
    code: `const input = null as unknown as CreateInput<User>;\n//    ^?`,
    contains: [],
  },
  {
    name: "UpdateInput of an entity",
    code: `const update = null as unknown as UpdateInput<User>;\n//    ^?`,
    contains: [],
  },
  {
    name: "the hydrated document: a strict array and the timestamps",
    code: `const tags = doc.tags;\n//    ^?`,
    contains: ["StrictArray<string>"],
  },
  {
    name: "aggregation rows",
    code: `const agg = await Orders.aggregate((p) => p.group((f) => ({ _id: f.status, total: fn.sum(f.amount) })));\n//    ^?`,
    contains: ["total: number"],
  },
  {
    name: "the plan of a builder",
    code: `const plan = Pipeline.from(Order).match({ amount: { $gt: 1 } }).plan();\n//    ^?`,
    contains: ["AggregatePlan<"],
  },
  {
    name: "a string id (EntityWithId)",
    code: `const country = await Countries.findById("FR").orFail().lean();\n//    ^?`,
    contains: ["_id: string", "name: string"],
  },
  {
    name: "a discriminator document",
    code: `const circle = await Circles.findOne().orFail().lean();\n//    ^?`,
    contains: ['__t: "circle"', "radius: number"],
  },
  {
    name: "the issues of a ValidationError",
    code: `try {\n} catch (error) {\n  if (error instanceof ValidationError) {\n    const issues = error.issues;\n//        ^?\n  }\n}`,
    contains: ["SchemaIssue"],
  },
  {
    name: "the model of a connection",
    code: `const model = client.connection.model(User);\n//    ^?`,
    contains: ["Model<User>"],
  },
];

/** One snippet that must fail to compile, and a fragment its message must contain. */
export interface ErrorCase {
  /** What the case shows. */
  readonly name: string;
  /** The snippet after {@link HEAD}. */
  readonly code: string;
  /** Text the message contains. */
  readonly contains: string;
}

/** The type-error cases: the message is readable, and the same through the declarations as through the sources. */
export const ERROR_CASES: readonly ErrorCase[] = [
  { name: "an unknown key in a filter", code: `Users.find({ nmae: "a" });`, contains: "nmae" },
  {
    name: "an unknown key in an update",
    code: `Users.updateOne({ name: "a" }, { $set: { nope: 1 } });`,
    contains: "nope",
  },
  {
    name: "a wrong type in a create input",
    code: `Users.create({ name: 1, email: "a", tags: [] });`,
    contains: "name",
  },
  { name: "a missing required field", code: `Users.create({ name: "a" });`, contains: "email" },
  { name: "the id of another type", code: `Countries.findById(3);`, contains: "number" },
  {
    name: "a @Prop whose declared type differs from its spec",
    code: `@Schema()\nclass Bad extends Entity {\n  @Prop(() => String)\n  n!: number;\n}\nvoid Bad;`,
    contains: "n",
  },
];
