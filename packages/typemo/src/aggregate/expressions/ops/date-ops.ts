import type { ObjectId, Timestamp } from "mongodb";
import { type AnyExprNode, type ExprNode, ExprNodes } from "../expr-node.ts";
import type { Arg, Exact, Nullable, PropagateNull } from "../expr-types.ts";
import { type Expr, OperatorFactory as F } from "../operator-factory.ts";

/*
 * Date operators. A date part accepts a `Date`, an `ObjectId` (its timestamp) or a `Timestamp`, and
 * optionally a time zone (`{ date, timezone }`).
 */

/**
 * A time unit of the date operators.
 *
 * @example
 * ```ts
 * const unit: DateUnit = "quarter";
 * ```
 */
export type DateUnit = "year" | "quarter" | "week" | "month" | "day" | "hour" | "minute" | "second" | "millisecond";

/**
 * The weekday a week starts on (`$dateDiff` / `$dateTrunc` with `unit: "week"`).
 *
 * @example
 * ```ts
 * const start: StartOfWeek = "monday";
 * ```
 */
export type StartOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

/**
 * A unit given as a literal or as an expression.
 *
 * @example
 * ```ts
 * const a: UnitArg = "day";
 * const b: UnitArg = f.unit; // a field holding a unit name
 * ```
 */
type UnitArg = DateUnit | ExprNode<DateUnit>;

/**
 * A weekday given as a literal or as an expression.
 *
 * @example
 * ```ts
 * const a: WeekdayArg = "sunday";
 * const b: WeekdayArg = f.weekStart;
 * ```
 */
type WeekdayArg = StartOfWeek | ExprNode<StartOfWeek>;

/**
 * A value the date-part operators read a moment from.
 *
 * @example
 * ```ts
 * const values: DateLike[] = [new Date(), new ObjectId(), new Timestamp({ t: 1, i: 0 })];
 * ```
 */
type DateLike = Date | ObjectId | Timestamp;

/**
 * The parts `$dateToParts` returns.
 *
 * @example
 * ```ts
 * const parts: DateParts = { year: 2026, month: 9, day: 29, hour: 12, minute: 0, second: 0, millisecond: 0 };
 * ```
 */
export interface DateParts {
  /** The year. */
  year: number;
  /** The month, 1-12. */
  month: number;
  /** The day of the month. */
  day: number;
  /** The hour. */
  hour: number;
  /** The minute. */
  minute: number;
  /** The second. */
  second: number;
  /** The millisecond. */
  millisecond: number;
}

/**
 * The ISO parts `$dateToParts` returns with `iso8601: true`.
 *
 * @example
 * ```ts
 * const parts: IsoDateParts = {
 *   isoWeekYear: 2026, isoWeek: 40, isoDayOfWeek: 2, hour: 12, minute: 0, second: 0, millisecond: 0,
 * };
 * ```
 */
export interface IsoDateParts {
  /** The ISO week-numbering year. */
  isoWeekYear: number;
  /** The ISO week number. */
  isoWeek: number;
  /** The ISO day of the week, 1 = Monday. */
  isoDayOfWeek: number;
  /** The hour. */
  hour: number;
  /** The minute. */
  minute: number;
  /** The second. */
  second: number;
  /** The millisecond. */
  millisecond: number;
}

/**
 * The calendar parts of `$dateFromParts`.
 *
 * @example
 * ```ts
 * const parts: CalendarParts = { year: 2026, month: 9, day: f.day, timezone: "Europe/Berlin" };
 * ```
 */
export interface CalendarParts {
  /** The year. */
  year: Arg<Nullable<number>>;
  /** The month, 1-12. */
  month?: Arg<Nullable<number>>;
  /** The day of the month. */
  day?: Arg<Nullable<number>>;
  /** The hour. */
  hour?: Arg<Nullable<number>>;
  /** The minute. */
  minute?: Arg<Nullable<number>>;
  /** The second. */
  second?: Arg<Nullable<number>>;
  /** The millisecond. */
  millisecond?: Arg<Nullable<number>>;
  /** The time zone name or offset. */
  timezone?: Arg<string>;
}

/**
 * The ISO week parts of `$dateFromParts`.
 *
 * @example
 * ```ts
 * const parts: IsoWeekParts = { isoWeekYear: 2026, isoWeek: 40, isoDayOfWeek: 1 };
 * ```
 */
export interface IsoWeekParts {
  /** The ISO week-numbering year. */
  isoWeekYear: Arg<Nullable<number>>;
  /** The ISO week number. */
  isoWeek?: Arg<Nullable<number>>;
  /** The ISO day of the week, 1 = Monday. */
  isoDayOfWeek?: Arg<Nullable<number>>;
  /** The hour. */
  hour?: Arg<Nullable<number>>;
  /** The minute. */
  minute?: Arg<Nullable<number>>;
  /** The second. */
  second?: Arg<Nullable<number>>;
  /** The millisecond. */
  millisecond?: Arg<Nullable<number>>;
  /** The time zone name or offset. */
  timezone?: Arg<string>;
}

/**
 * `$dateFromParts`: calendar parts or ISO week parts, never mixed (the server rejects that too).
 *
 * @example
 * ```ts
 * fn.dateFromParts({ year: 2026, month: 9, day: 29 }); // Expr<Date>
 * fn.dateFromParts({ isoWeekYear: 2026, isoWeek: 40 }); // Expr<Date>
 * ```
 */
export interface DateFromPartsOp {
  /**
   * A date from calendar parts.
   *
   * @param spec - The calendar parts; unknown keys are rejected.
   * @returns The date; `null` when a part can be `null`.
   */
  <const S extends CalendarParts>(spec: Exact<S, CalendarParts>): Expr<PropagateNull<Date, S[keyof S]>>;
  /**
   * A date from ISO week parts.
   *
   * @param spec - The ISO week parts; unknown keys are rejected.
   * @returns The date; `null` when a part can be `null`.
   */
  <const S extends IsoWeekParts>(spec: Exact<S, IsoWeekParts>): Expr<PropagateNull<Date, S[keyof S]>>;
}

/** The `$dateFromParts` operator. */
const dateFromParts = ((spec: object): AnyExprNode =>
  F.node("$dateFromParts", ExprNodes.spec(spec))) as DateFromPartsOp;

/**
 * The date of a date-part argument: the argument itself, or the `date` of `{ date, timezone }`.
 *
 * @typeParam A - The argument type.
 * @example
 * ```ts
 * type A = DateInput<Expr<Date>>; // Expr<Date>
 * type B = DateInput<{ date: Expr<Date>; timezone: string }>; // Expr<Date>
 * ```
 */
type DateInput<A> = A extends ExprNode<unknown> ? A : A extends { date: infer D } ? D : A;

/**
 * Builds a date-part operator (`$year`, `$month`, …).
 *
 * @typeParam R - The result type of the part.
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator taking a date or `{ date, timezone }`; `null` when the date can be `null`.
 */
const datePart =
  <R = number>(op: string) =>
  <A extends Arg<Nullable<DateLike>> | { date: Arg<Nullable<DateLike>>; timezone?: Arg<string> }>(
    x: A,
  ): Expr<PropagateNull<R, DateInput<A>>> => {
    const isSpec = typeof x === "object" && x !== null && !ExprNodes.is(x) && "date" in x && !(x instanceof Date);
    return F.node(op, isSpec ? ExprNodes.spec(x) : ExprNodes.serialize(x));
  };

/** Date operators. */
export const dateOps = {
  /**
   * Year.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/year/
   */
  year: datePart("$year"),
  /**
   * Month (1–12).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/month/
   */
  month: datePart("$month"),
  /**
   * Day of the month.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dayOfMonth/
   */
  dayOfMonth: datePart("$dayOfMonth"),
  /**
   * Hour.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/hour/
   */
  hour: datePart("$hour"),
  /**
   * Minute.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/minute/
   */
  minute: datePart("$minute"),
  /**
   * Second.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/second/
   */
  second: datePart("$second"),
  /**
   * Millisecond.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/millisecond/
   */
  millisecond: datePart("$millisecond"),
  /**
   * Day of the week (1 = Sunday).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dayOfWeek/
   */
  dayOfWeek: datePart("$dayOfWeek"),
  /**
   * Day of the year.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dayOfYear/
   */
  dayOfYear: datePart("$dayOfYear"),
  /**
   * Week of the year (0–53).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/week/
   */
  week: datePart("$week"),
  /**
   * ISO week.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/isoWeek/
   */
  isoWeek: datePart("$isoWeek"),
  /**
   * ISO week-numbering year: an int64 on the server (shape test), unlike the other parts.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/isoWeekYear/
   */
  isoWeekYear: datePart<bigint>("$isoWeekYear"),
  /**
   * ISO day of the week (1 = Monday).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/isoDayOfWeek/
   */
  isoDayOfWeek: datePart("$isoDayOfWeek"),

  /**
   * Adds an amount of a unit.
   *
   * @param spec - The start date, the unit, the amount and the optional time zone.
   * @returns The later date; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateAdd/
   */
  dateAdd: <D extends Arg<Nullable<Date>>, A extends Arg<Nullable<number>>>(spec: {
    startDate: D;
    unit: UnitArg;
    amount: A;
    timezone?: Arg<string>;
  }): Expr<PropagateNull<Date, D | A>> => F.node("$dateAdd", ExprNodes.spec(spec)),
  /**
   * Subtracts an amount of a unit.
   *
   * @param spec - The start date, the unit, the amount and the optional time zone.
   * @returns The earlier date; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateSubtract/
   */
  dateSubtract: <D extends Arg<Nullable<Date>>, A extends Arg<Nullable<number>>>(spec: {
    startDate: D;
    unit: UnitArg;
    amount: A;
    timezone?: Arg<string>;
  }): Expr<PropagateNull<Date, D | A>> => F.node("$dateSubtract", ExprNodes.spec(spec)),
  /**
   * Number of unit boundaries between two dates (an int64).
   *
   * @param spec - The two dates, the unit and the optional time zone and first weekday.
   * @returns The number of boundaries; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateDiff/
   */
  dateDiff: <S extends Arg<Nullable<Date>>, E extends Arg<Nullable<Date>>>(spec: {
    startDate: S;
    endDate: E;
    unit: UnitArg;
    timezone?: Arg<string>;
    startOfWeek?: WeekdayArg;
  }): Expr<PropagateNull<bigint, S | E>> => F.node("$dateDiff", ExprNodes.spec(spec)),
  /**
   * Truncates to a unit (or `binSize` units).
   *
   * @param spec - The date, the unit, the optional bin size, time zone and first weekday.
   * @returns The truncated date; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateTrunc/
   */
  dateTrunc: <D extends Arg<Nullable<Date>>, B extends Arg<Nullable<number>> = never>(spec: {
    date: D;
    unit: UnitArg;
    binSize?: B;
    timezone?: Arg<string>;
    startOfWeek?: WeekdayArg;
  }): Expr<PropagateNull<Date, D | B>> => F.node("$dateTrunc", ExprNodes.spec(spec)),
  /**
   * A date from calendar or ISO week parts.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateFromParts/
   */
  dateFromParts,
  /**
   * A date → its parts (ISO parts with `iso8601: true`).
   *
   * @param spec - The date and the optional time zone and ISO flag.
   * @returns The parts; `null` when the date can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateToParts/
   */
  dateToParts: <D extends Arg<Nullable<Date>>, const Iso extends boolean = false>(spec: {
    date: D;
    timezone?: Arg<string>;
    iso8601?: Iso;
  }): Expr<PropagateNull<Iso extends true ? IsoDateParts : DateParts, D>> =>
    F.node("$dateToParts", ExprNodes.spec(spec)),
  /**
   * Parses a string; `onError`/`onNull` join the result.
   *
   * @param spec - The string, the optional format and time zone, and the optional fallbacks.
   * @returns The parsed date.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateFromString/
   */
  dateFromString: <D extends Arg<Nullable<string>>, const OnError = never, const OnNull = never>(spec: {
    dateString: D;
    format?: Arg<string>;
    timezone?: Arg<string>;
    onError?: Arg<OnError>;
    onNull?: Arg<OnNull>;
  }): Expr<Date | OnError | ([OnNull] extends [never] ? PropagateNull<never, D> : OnNull)> =>
    F.node("$dateFromString", ExprNodes.spec(spec)),
  /**
   * Formats a date; `onNull` replaces a `null` date.
   *
   * @param spec - The date, the optional format and time zone, and the optional fallback for `null`.
   * @returns The formatted string.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/dateToString/
   */
  dateToString: <D extends Arg<Nullable<Date>>, const OnNull = never>(spec: {
    date: D;
    format?: Arg<string>;
    timezone?: Arg<string>;
    onNull?: Arg<OnNull>;
  }): Expr<[OnNull] extends [never] ? PropagateNull<string, D> : string | OnNull> =>
    F.node("$dateToString", ExprNodes.spec(spec)),
  /**
   * Seconds of a `Timestamp` (an int64).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/tsSecond/
   */
  tsSecond: F.unaryNull<Timestamp, bigint>("$tsSecond"),
  /**
   * Increment of a `Timestamp` (an int64).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/tsIncrement/
   */
  tsIncrement: F.unaryNull<Timestamp, bigint>("$tsIncrement"),
};
