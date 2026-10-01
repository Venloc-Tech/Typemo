/*
 * Type tests of the expression layer: result types, null propagation, arity, input types and expression kinds.
 * Every `@ts-expect-error` says what must fail.
 */
import type { AssertEqual, Expect } from "@venloc/typemo-test-kit";
import type { Binary, Decimal128, ObjectId, Timestamp, UUID } from "mongodb";
import {
  type ExprFor,
  type ExprKind,
  type ExprNode,
  type FieldProxy,
  fn,
  type NodeKind,
  type NodeValue,
  type VarProxy,
  type Vars,
  withWindow,
} from "../../../src/index.ts";

interface Line {
  sku: string;
  price: number;
  qty?: number;
}

interface Doc {
  _id: ObjectId;
  name: string;
  nick?: string;
  age: number;
  score: number | null;
  big: bigint;
  exact: Decimal128;
  at: Date;
  maybeAt?: Date;
  lines: Line[];
  tags: string[];
  address?: { city: string; zip: string | null };
  scores: { [key: string]: number };
  ts: Timestamp;
}

declare const f: FieldProxy<Doc>;
type V<N> = NodeValue<N>;

// ---- field references --------------------------------------------------------------------------------
export type FieldRefs = [
  Expect<AssertEqual<V<typeof f.name>, string>>,
  Expect<AssertEqual<V<typeof f.nick>, string | undefined>>, // optional key: may be missing
  Expect<AssertEqual<V<typeof f.address.city>, string | undefined>>, // absent parent: every field below may be missing
  Expect<AssertEqual<V<typeof f.address.zip>, string | null | undefined>>,
  Expect<AssertEqual<V<typeof f.scores.gold>, number | undefined>>, // a record key may be missing
  Expect<AssertEqual<V<typeof f.lines>, Line[]>>, // an array is a leaf
  Expect<AssertEqual<V<typeof f>, Doc>>, // f itself is $$ROOT
];

// @ts-expect-error — a typo in a field reference is a property error
f.nmae;
// @ts-expect-error — an opaque BSON value is never walked into (ObjectId has no `timestamp` path)
f._id.timestamp;

// ---- arithmetic: numeric widening, dates, null propagation -----------------------------------------------
export type Arithmetic = [
  Expect<AssertEqual<V<ReturnType<typeof fn.add<[typeof f.age, 1]>>>, number>>,
  Expect<AssertEqual<V<typeof addNull>, number | null>>,
  Expect<AssertEqual<V<typeof addDate>, Date>>,
  Expect<AssertEqual<V<typeof subDates>, bigint>>, // Date - Date is an int64 (checked on the server)
  Expect<AssertEqual<V<typeof subMs>, Date>>,
  Expect<AssertEqual<V<typeof bigSum>, bigint>>,
  Expect<AssertEqual<V<typeof decimal>, Decimal128>>,
  Expect<AssertEqual<V<typeof ratio>, number>>,
  Expect<AssertEqual<V<typeof sqrtDec>, Decimal128>>,
  Expect<AssertEqual<V<typeof sig>, number | null>>,
];
const addNull = fn.add(f.age, f.score);
const addDate = fn.add(f.at, 1000);
const subDates = fn.subtract(f.at, f.at);
const subMs = fn.subtract(f.at, 1000);
const bigSum = fn.multiply(f.big, 2n);
const decimal = fn.add(f.exact, 1);
const ratio = fn.divide(f.age, 3);
const sqrtDec = fn.sqrt(f.exact);
const sig = fn.sigmoid(f.score);

// @ts-expect-error — a string is not a number
fn.multiply(f.name, 2);
// @ts-expect-error — $divide takes exactly two arguments
fn.divide(1, 2, 3);
// @ts-expect-error — $multiply takes at least two arguments
fn.multiply(f.age);

// ---- strings, comparison, logic ---------------------------------------------------------------------------
export type Strings = [
  Expect<AssertEqual<V<typeof upper>, string>>, // $toUpper gives "" for null
  Expect<AssertEqual<V<typeof concatNull>, string | null>>,
  Expect<AssertEqual<V<typeof cmp>, -1 | 0 | 1>>,
  Expect<AssertEqual<V<typeof cond>, "big" | 0>>,
  Expect<AssertEqual<V<typeof sw>, "a" | "b" | "c">>,
  Expect<AssertEqual<V<typeof ifNull>, string>>,
];
const upper = fn.toUpper(f.nick);
const concatNull = fn.concat(f.name, "-", f.nick);
const cmp = fn.cmp(f.age, 3);
const cond = fn.cond(fn.gt(f.age, 18), "big", 0);
const sw = fn.switch({
  branches: [
    // biome-ignore lint/suspicious/noThenProperty: `then` is the key of a MongoDB $switch branch
    { case: true, then: "a" },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the key of a MongoDB $switch branch
    { case: false, then: "b" },
  ],
  default: "c",
});
const ifNull = fn.ifNull(f.nick, f.name);

// @ts-expect-error — both sides of a comparison have one type (a number is not a string)
fn.gt(f.age, "x");
// @ts-expect-error — $strLenCP fails on null on the server, so a nullable input is refused
fn.strLenCP(f.nick);

// ---- conversion (lean forms of the BSON type table) --------------------------------------------------------------
export type Conversion = [
  Expect<AssertEqual<V<typeof toLong>, bigint>>,
  Expect<AssertEqual<V<typeof toDec>, Decimal128>>,
  Expect<AssertEqual<V<typeof toUuid>, UUID>>,
  Expect<AssertEqual<V<typeof convertLong>, bigint>>,
  Expect<AssertEqual<V<typeof convertFail>, string | -1>>,
  Expect<AssertEqual<V<typeof convertUuid>, UUID>>,
  Expect<AssertEqual<V<typeof convertBin>, Binary>>,
  Expect<AssertEqual<V<typeof isoYear>, bigint>>, // $isoWeekYear is an int64 (checked on the server)
  Expect<AssertEqual<V<typeof tsSec>, bigint>>,
];
const toLong = fn.toLong(f.age);
const toDec = fn.toDecimal(f.age);
const toUuid = fn.toUUID("10b1dd36-b2b2-46f5-ba90-9058d4a499bf");
const convertLong = fn.convert({ input: f.age, to: "long" });
const convertFail = fn.convert({ input: f.name, to: "string", onError: -1 });
const convertUuid = fn.convert({ input: f.name, to: { type: "binData", subtype: 4 }, format: "uuid" });
const convertBin = fn.convert({ input: f.name, to: "binData", format: "base64" });
const isoYear = fn.isoWeekYear(f.at);
const tsSec = fn.tsSecond(f.ts);
/* $toDate: a double, a long, a string, an ObjectId stay valid; an integer literal is sent as an int32 and refused. */
export type ToDate = [
  Expect<AssertEqual<V<typeof dateOfLong>, Date>>,
  Expect<AssertEqual<V<typeof dateOfDouble>, Date>>,
  Expect<AssertEqual<V<typeof dateOfField>, Date>>,
  Expect<AssertEqual<V<typeof dateOfString>, Date>>,
];
const dateOfLong = fn.toDate(fn.toLong(0));
const dateOfDouble = fn.toDate(1.5);
const dateOfField = fn.toDate(f.age);
const dateOfString = fn.toDate("2026-03-01T00:00:00Z");
// @ts-expect-error — $toDate of an int32 is refused by the server ("Unsupported conversion from int to date")
fn.toDate(0);
// @ts-expect-error — a negative integer literal is an int32 too
fn.toDate(-86_400_000);

// ---- arrays and scoped operators ---------------------------------------------------------------------------
export type Arrays = [
  Expect<AssertEqual<V<typeof elem>, Line | undefined>>, // past the end: missing
  Expect<AssertEqual<V<typeof skus>, string[]>>,
  Expect<AssertEqual<V<typeof cheap>, Line[]>>,
  Expect<AssertEqual<V<typeof total>, number>>,
  Expect<AssertEqual<V<typeof sorted>, Line[]>>,
  Expect<AssertEqual<V<typeof union>, (string | number)[]>>,
];
const elem = fn.arrayElemAt(f.lines, 0);
const skus = fn.map({ input: f.lines, in: (line) => line.sku });
const cheap = fn.filter({ input: f.lines, cond: (line) => fn.lt(line.price, 10) });
const total = fn.reduce({ input: f.lines, initialValue: 0, in: (acc, line) => fn.add(acc, line.price) });
const sorted = fn.sortArray({ input: f.lines, sortBy: { price: -1 } });
const union = fn.concatArrays(f.tags, [1, 2]);

// @ts-expect-error — $sortArray.sortBy names fields of the element ("prcie" is a typo)
fn.sortArray({ input: f.lines, sortBy: { prcie: -1 } });
// @ts-expect-error — a variable is not a document field: it has no FieldPath (so it cannot be a sortBy key)
fn.top({ output: f.age, sortBy: [[{} as VarProxy<number>, 1]] });

// ---- kinds -------------------------------------------------------------------------------------------
export type Kinds = [
  Expect<AssertEqual<NodeKind<typeof f.age>, "expr">>,
  Expect<AssertEqual<NodeKind<ReturnType<typeof fn.push<typeof f.age>>>, "acc" | "window" | "bounded">>,
  Expect<AssertEqual<NodeKind<typeof sumOne>, "expr" | "acc" | "window" | "bounded">>,
  Expect<AssertEqual<NodeKind<typeof sumMany>, "expr">>,
  Expect<AssertEqual<NodeKind<ReturnType<typeof fn.rank>>, "window" | "needsSortBy" | "singleSortKey">>, // one sortBy field
  Expect<AssertEqual<NodeKind<typeof bounded>, "window" | "needsSortBy">>,
  Expect<AssertEqual<NodeKind<typeof unbounded>, "window">>,
  Expect<AssertEqual<NodeKind<ReturnType<typeof fn.locf<typeof f.score>>>, "window">>,
  Expect<AssertEqual<NodeKind<ReturnType<typeof fn.derivative>>, "bounded" | "needsSortBy">>, // needs withWindow
];
const sumOne = fn.sum(f.age);
const sumMany = fn.sum(f.age, 1);
const bounded = withWindow(fn.sum(f.age), { documents: ["unbounded", "current"] });
const unbounded = withWindow(fn.sum(f.age), { documents: ["unbounded", "unbounded"] });
export type AllKinds = ExprKind;

// @ts-expect-error — an accumulator cannot be nested inside an expression
fn.add(fn.push(f.age), 1);
// @ts-expect-error — a window function is not an expression
fn.gt(fn.rank(), 1);
// @ts-expect-error — an accumulator is not an expression, not even where any value is accepted
fn.isArray(fn.push(f.age));
// @ts-expect-error — $rank takes no window
withWindow(fn.rank(), { documents: ["unbounded", "current"] });
// @ts-expect-error — $percentile fractions are within [0, 1]
fn.percentile({ input: f.age, p: [1.5] });

// ---- $expr contract of the query layer ----------------------------------------------------------------
export const ok: ExprFor<Doc> = (e) => fn.and(fn.gt(e.age, 18), fn.eq(e.name, "x"));
// @ts-expect-error — $expr must be boolean-valued: a number is refused
export const notBoolean: ExprFor<Doc> = (e) => fn.add(e.age, 1);
// @ts-expect-error — $expr takes an expression, not an accumulator
export const accumulatorInExpr: ExprFor<Doc> = (e) => fn.push(e.age);

// ---- system variables -----------------------------------------------------------------------------------------
export type Variables = [
  Expect<AssertEqual<V<typeof Vars.NOW>, Date>>,
  Expect<AssertEqual<V<typeof Vars.CLUSTER_TIME>, Timestamp>>,
  Expect<AssertEqual<typeof Vars.REMOVE, ExprNode<undefined>>>,
];
