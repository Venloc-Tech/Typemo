import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/**
 * Full ISO 8601 date-time: date, `T`, time with seconds, optional milliseconds (1–3 digits), and a
 * mandatory zone (`Z` or `±HH:MM`). Without a zone the moment would depend on the process time zone.
 */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * ISO 8601 calendar date without a time: UTC midnight, as ISO 8601 and ECMAScript
 * (`Date.parse("2020-01-02")`) define it — independent of the process time zone.
 */
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;
/** Months (1-based) that have 30 days. */
const THIRTY_DAY_MONTHS: ReadonlySet<number> = new Set([4, 6, 9, 11]);

/**
 * BSON date, hydrated as a `Date` (always a fresh copy: a `Date` is mutable). Accepts a valid
 * `Date`, a full ISO 8601 date-time string with a zone (safe list: "ISO 8601 → Date"), an ISO
 * calendar date `YYYY-MM-DD`, read as UTC midnight, and a finite INTEGER number of
 * milliseconds since the epoch within the `Date` range (`Date.now()`, JSON timestamps).
 * Refused: fractional or non-finite numbers, numeric strings — `'2017'`, `'42'`, `'1.5'` (Mongoose: year 2042,
 * 2001-01-05), a date-time without a zone (its moment would depend on the machine), `Invalid Date`,
 * `valueOf()` objects, arrays (Mongoose: `[5]` → 2001-05-01).
 */
export class DateCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "Date";

  /**
   * Accepts a valid `Date`, an ISO 8601 string or integer milliseconds and returns a fresh `Date`.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns A new `Date`.
   * @throws {CastError} When the input has another type, is `Invalid Date`, is not an ISO 8601 string or
   * the number is not a finite integer within the `Date` range.
   */
  static cast(value: unknown, path = ""): Date {
    if (typeof value === "number") return DateCaster.fromMilliseconds(value, path);
    if (BsonGuards.isDate(value)) {
      const time = value.getTime();
      return Number.isNaN(time)
        ? CastSupport.fail(path, value, DateCaster.expected, "format", "Invalid Date")
        : new Date(time);
    }
    if (typeof value !== "string") {
      return CastSupport.reject(
        path,
        value,
        DateCaster.expected,
        "a Date, an ISO 8601 date or date-time string, or integer milliseconds",
      );
    }
    const time = DateCaster.parseIso(value);
    return time === undefined
      ? CastSupport.fail(
          path,
          value,
          DateCaster.expected,
          "format",
          "not an ISO 8601 date (YYYY-MM-DD) or a full date-time with a zone (YYYY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm))",
        )
      : new Date(time);
  }

  /**
   * Returns the `Date` as the driver value.
   *
   * @param value - The hydrated `Date`.
   * @returns The same `Date`.
   */
  static encode(value: Date): Date {
    return value;
  }

  /**
   * Converts a finite integer number of milliseconds since the epoch, within the `Date` range (±8.64e15).
   *
   * @param value - The number of milliseconds.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The `Date` at that moment.
   * @throws {CastError} When the number is not finite, is fractional or is outside the `Date` range.
   */
  private static fromMilliseconds(value: number, path: string): Date {
    if (!Number.isFinite(value)) {
      return CastSupport.fail(path, value, DateCaster.expected, "finite", "milliseconds must be a finite number");
    }
    if (!Number.isInteger(value)) {
      return CastSupport.fail(path, value, DateCaster.expected, "integer", "milliseconds must be an integer");
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? CastSupport.fail(path, value, DateCaster.expected, "range", "outside the Date range of ±8.64e15 ms")
      : date;
  }

  /**
   * Parses the ISO 8601 forms (date-only or full date-time) by hand: `Date.parse` accepts engine-specific formats
   * (V8 and JavaScriptCore in Bun disagree) and reads zone-less strings in local time.
   *
   * @param text - The string to parse.
   * @returns Milliseconds since the epoch, or `undefined` when the text is not that format or a component is
   * out of range (`02-30`, `24:00`).
   */
  static parseIso(text: string): number | undefined {
    const dateOnly = ISO_DATE_ONLY.exec(text);
    if (dateOnly) {
      const [, y, mo, d] = dateOnly;
      return DateCaster.utc(Number(y), Number(mo), Number(d), 0, 0, 0, 0);
    }
    const match = ISO_DATE_TIME.exec(text);
    if (!match) return undefined;
    const [, y, mo, d, h, mi, s, fraction, sign, oh, om] = match;
    const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const offsetHours = Number(oh ?? 0);
    const offsetMinutes = Number(om ?? 0);
    if (offsetHours > 23 || offsetMinutes > 59) return undefined;
    const time = DateCaster.utc(year, month, day, hour, minute, second, Number((fraction ?? "0").padEnd(3, "0")));
    if (time === undefined) return undefined;
    const offset = (offsetHours * 60 + offsetMinutes) * MS_PER_MINUTE;
    return time - (sign === "-" ? -offset : offset);
  }

  /**
   * UTC time of the components.
   *
   * @param year - The full year (0-9999).
   * @param month - The month, 1-12.
   * @param day - The day of the month.
   * @param hour - The hour, 0-23.
   * @param minute - The minute, 0-59.
   * @param second - The second, 0-59.
   * @param ms - The milliseconds, 0-999.
   * @returns Milliseconds since the epoch, or `undefined` when a component is out of range (`02-30`, `24:00`, `:60`).
   */
  private static utc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    ms: number,
  ): number | undefined {
    if (month < 1 || month > 12 || day < 1 || day > DateCaster.daysInMonth(year, month)) return undefined;
    if (hour > 23 || minute > 59 || second > 59) return undefined;
    const date = new Date(0);
    /* setUTCFullYear, not Date.UTC: Date.UTC maps the years 0–99 to 1900–1999. */
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, ms);
    return date.getTime();
  }

  /**
   * The number of days in a month of the Gregorian calendar.
   *
   * @param year - The full year (decides February).
   * @param month - The month, 1-12.
   * @returns 28, 29, 30 or 31.
   */
  private static daysInMonth(year: number, month: number): number {
    if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
    return THIRTY_DAY_MONTHS.has(month) ? 30 : 31;
  }
}
