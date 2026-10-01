/*
 * `.parse(schema)` — the result type is the Standard Schema's OUTPUT per row (a list for `find` and `aggregate`,
 * `| null` for a single row without `orFail`); available on lean queries, aggregations and their cursors only.
 * The model's `~standard` is typed by the entity (`CreateInput<T>` → `DataFields<T>`).
 */
import { expectTypeOf, type InferStandardOutput, z } from "@venloc/typemo-test-kit";
import type {
  CreateInput,
  DataFields,
  Model,
  ModelOperations,
  QueryCursor,
  StandardSchemaInput,
  StandardSchemaOutput,
} from "../../../src/internal.ts";
import type { Person } from "../../fixtures/populate/populate-entities.ts";

declare const People: ModelOperations<Person>;
declare const PeopleModel: Model<Person>;

const Row = z.object({ name: z.string(), age: z.number().optional() });
type Row = z.output<typeof Row>;

// ---- the reading of a Standard Schema's types (the spec's InferInput / InferOutput) -------------------------
expectTypeOf<StandardSchemaOutput<typeof Row>>().toEqualTypeOf<Row>();
expectTypeOf<StandardSchemaInput<typeof Row>>().toEqualTypeOf<z.input<typeof Row>>();
const Upper = z.string().transform((value) => value.length);
expectTypeOf<StandardSchemaOutput<typeof Upper>>().toEqualTypeOf<number>(); // output, not input

// ---- queries ------------------------------------------------------------------------------------------------
const many = () => People.find().lean().parse(Row);
expectTypeOf<Awaited<ReturnType<typeof many>>>().toEqualTypeOf<Row[]>();
const one = () => People.findOne().lean().parse(Row);
expectTypeOf<Awaited<ReturnType<typeof one>>>().toEqualTypeOf<Row | null>();
const found = () => People.findOne().orFail().lean().parse(Row);
expectTypeOf<Awaited<ReturnType<typeof found>>>().toEqualTypeOf<Row>();
declare const id: import("mongodb").ObjectId;
const byId = () => PeopleModel.findById(id).lean().parse(Row);
expectTypeOf<Awaited<ReturnType<typeof byId>>>().toEqualTypeOf<Row | null>();
const modified = () =>
  People.findOneAndUpdate({ name: "x" }, { $set: { age: 1 } })
    .lean()
    .parse(Row);
expectTypeOf<Awaited<ReturnType<typeof modified>>>().toEqualTypeOf<Row | null>();
expectTypeOf(People.find().lean().parse(Row).cursor()).toEqualTypeOf<QueryCursor<Row>>();

// the exact contract of the parsed rows
People.find().lean().parse(Row).expect<{ name: string; age?: number | undefined }>();
// @ts-expect-error — EXTRA against the schema's output
People.find().lean().parse(Row).expect<{ name: string }>();

// @ts-expect-error — a hydrated query: parse() validates rows (call .lean() or .plain() first)
People.find().parse(Row);
// @ts-expect-error — a single row has no cursor
People.findOne().lean().parse(Row).cursor();
const notSchema = { parse: (value: unknown) => value };
// @ts-expect-error — not a Standard Schema (no "~standard")
People.find().lean().parse(notSchema);
// @ts-expect-error — parse is terminal: the query is fixed before it is parsed
People.find().lean().parse(Row).sort({ name: 1 });

// ---- aggregations --------------------------------------------------------------------------------------------
const rows = PeopleModel.aggregate((p) => p.match({ name: "ann" })).parse(Row);
expectTypeOf<Awaited<typeof rows>>().toEqualTypeOf<Row[]>();
expectTypeOf(rows.cursor()).toEqualTypeOf<QueryCursor<Row>>();

// ---- the model as a Standard Schema ------------------------------------------------------------------------
expectTypeOf<StandardSchemaInput<typeof PeopleModel>>().toEqualTypeOf<CreateInput<Person>>();
expectTypeOf<StandardSchemaOutput<typeof PeopleModel>>().toEqualTypeOf<DataFields<Person>>();
expectTypeOf<InferStandardOutput<typeof PeopleModel>>().toEqualTypeOf<DataFields<Person>>(); // a spec-only consumer
const byModel = () => People.find().lean().parse(PeopleModel);
expectTypeOf<Awaited<ReturnType<typeof byModel>>>().toEqualTypeOf<DataFields<Person>[]>();
