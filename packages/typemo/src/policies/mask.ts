import { createHmac } from "node:crypto";
import type { Decimal128 } from "bson";
import { BsonGuards } from "../bson/bson-guards.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import type { SensitiveJson } from "../schema/options/prop-options.ts";

/*
 * Ready-made mask functions: each factory returns `{ mask }`, so it fits the field option `sensitive` and the
 * query `.mask()`. The rules shared by every mask:
 * - the mask is typed by the value it accepts (`Mask.email()` on a number field is a compile error); `null` and
 *   `undefined` are accepted by the type, since a nullable field hands them in;
 * - a mask never throws on data: `null`, a value of a wrong runtime type or an unusable value give `"?"`
 *   (a leak is worse than a lost detail); only invalid FACTORY arguments throw (`ConfigurationError`, at once);
 * - everything constant is computed at factory time; a call is a pass over char codes, no regex;
 * - strings are counted by code points: an emoji or a surrogate pair is never cut in half.
 */

/**
 * A ready-made mask accepting values of type `T` (and `null`/`undefined`, which it masks as `"?"`).
 *
 * @typeParam T - The type of value the mask accepts.
 * @example
 * ```ts
 * const mask: MaskOf<string> = Mask.email();
 * mask.mask("alice@gmail.com"); // "a***@gmail.com"
 * mask.mask(null); // "?"
 * ```
 */
export interface MaskOf<T> {
  /** Turns a value into its JSON-safe outside form; never throws on data. */
  readonly mask: (value: T | null | undefined) => SensitiveJson;
}

/**
 * What `Mask.when` does with a value: the real value, `"?"`, or another mask.
 *
 * @typeParam T - The type of value the choice applies to.
 * @example
 * ```ts
 * const choice: MaskChoice<string> = Mask.email(); // or "show" / "mask"
 * ```
 */
export type MaskChoice<T> = "show" | "mask" | MaskOf<T>;

/**
 * A value `Mask.size` can measure.
 *
 * @example
 * ```ts
 * const values: MeasurableValue[] = ["abc", [1, 2], new Map(), new Set()];
 * ```
 */
export type MeasurableValue = string | readonly unknown[] | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>;

/**
 * A value `Mask.round` can round.
 *
 * @example
 * ```ts
 * const values: RoundableValue[] = [3.14, 10n, Decimal128.fromString("1.26")];
 * ```
 */
export type RoundableValue = number | bigint | Decimal128;

/** The text every mask gives for a value it cannot mask (a leak is worse than a lost detail). */
const MASKED = "?";

/** Whether a UTF-16 code unit is a high (leading) surrogate. */
const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
/** Whether a UTF-16 code unit is a low (trailing) surrogate. */
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * The number of code points of a string (a surrogate pair counts once).
 *
 * @param text - The string to measure.
 * @returns The count of code points.
 */
const codePoints = (text: string): number => {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (isHigh(text.charCodeAt(index)) && isLow(text.charCodeAt(index + 1))) index++;
    count++;
  }
  return count;
};

/**
 * The UTF-16 index after the first `points` code points.
 *
 * @param text - The source string.
 * @param points - How many code points to take from the start.
 * @returns The index just past them (the string length when it has fewer).
 */
const indexAfter = (text: string, points: number): number => {
  let index = 0;
  for (let taken = 0; taken < points && index < text.length; taken++) {
    index += isHigh(text.charCodeAt(index)) && isLow(text.charCodeAt(index + 1)) ? 2 : 1;
  }
  return index;
};

/**
 * The UTF-16 index where the last `points` code points start.
 *
 * @param text - The source string.
 * @param points - How many code points to take from the end.
 * @returns The index of the first of them (0 when the string has fewer).
 */
const indexBeforeLast = (text: string, points: number): number => {
  let index = text.length;
  for (let taken = 0; taken < points && index > 0; taken++) {
    index -= isLow(text.charCodeAt(index - 1)) && isHigh(text.charCodeAt(index - 2)) ? 2 : 1;
  }
  return index;
};

/** Whether a code unit is an ASCII digit. */
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
/** Whether a code unit is a space-like character (ASCII whitespace, no-break and ideographic spaces). */
const isSpace = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 13 || code === 0xa0 || code === 0x202f || code === 0x3000;

/**
 * The index of the first character that is not a space.
 *
 * @param text - The string to scan.
 * @returns The index (the string length when it is all spaces).
 */
const indexOfFirstNonSpace = (text: string): number => {
  let index = 0;
  while (index < text.length && isSpace(text.charCodeAt(index))) index++;
  return index;
};

/**
 * The ASCII digits of a string, in order.
 *
 * @param text - The source string.
 * @returns Only the digit characters, joined.
 */
const digitsOf = (text: string): string => {
  let digits = "";
  for (let index = 0; index < text.length; index++) {
    if (isDigit(text.charCodeAt(index))) digits += text[index];
  }
  return digits;
};

/** Whether a code unit is an ASCII hexadecimal digit. */
const isHexDigit = (code: number): boolean =>
  isDigit(code) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70);

/**
 * Checks a factory argument that must be a non-negative integer.
 *
 * @param factory - The factory name, for the message.
 * @param name - The argument name, for the message.
 * @param value - The value to check.
 * @returns The same value.
 * @throws {ConfigurationError} When it is not a non-negative safe integer.
 */
const requireCount = (factory: string, name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ConfigurationError(`Mask.${factory}: "${name}" must be a non-negative integer, got ${String(value)}`);
  }
  return value;
};

/**
 * Checks a factory argument that must be exactly one character (one code point).
 *
 * @param factory - The factory name, for the message.
 * @param char - The value to check.
 * @returns The same character.
 * @throws {ConfigurationError} When it is not a single character.
 */
const requireChar = (factory: string, char: string): string => {
  if (typeof char !== "string" || codePoints(char) !== 1) {
    throw new ConfigurationError(`Mask.${factory}: "char" must be exactly one character, got ${JSON.stringify(char)}`);
  }
  return char;
};

/**
 * The digits after the decimal point of a step (`0.05` → 2), for a rounding without float noise.
 *
 * @param step - The rounding step.
 * @returns The number of decimals its text form has.
 */
const decimalsOf = (step: number): number => {
  const text = String(step);
  const exponent = text.indexOf("e-");
  if (exponent !== -1)
    return (
      Number(text.slice(exponent + 2)) + Math.max(0, text.indexOf(".") === -1 ? 0 : exponent - text.indexOf(".") - 1)
    );
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
};

/** An exact decimal: `digits × 10^-scale` (`scale ≥ 0`). */
type ExactDecimal = { readonly negative: boolean; readonly digits: bigint; readonly scale: number };

const DECIMAL_TEXT = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parses a decimal string (`Decimal128#toString`, `String(number)`) exactly.
 *
 * @param text - The decimal text.
 * @returns The exact decimal; `undefined` for `NaN`, `Infinity` or any non-decimal text.
 */
const parseDecimal = (text: string): ExactDecimal | undefined => {
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) return undefined;
  const fraction = match[3] ?? "";
  const scale = fraction.length - Number(match[4] ?? "0");
  const digits = BigInt(`${match[2] ?? "0"}${fraction}`);
  return scale >= 0
    ? { negative: match[1] === "-", digits, scale }
    : { negative: match[1] === "-", digits: digits * 10n ** BigInt(-scale), scale: 0 };
};

/**
 * Rounds a decimal string to the step exactly in bigint arithmetic, half away from zero (as the bigint branch).
 * The result keeps the step's decimals (`round(0.05)`: `"1.26"` → `"1.25"`). A `Number` would lose digits of
 * a `Decimal128` beyond 2^53 or past ~17 significant digits.
 *
 * @param text - The decimal text of the value.
 * @param step - The rounding step.
 * @returns The rounded decimal string, or `"?"` when the text is not a finite decimal.
 */
const roundDecimalText = (text: string, step: ExactDecimal): SensitiveJson => {
  const value = parseDecimal(text);
  if (value === undefined) return MASKED;
  const scale = Math.max(value.scale, step.scale);
  const scaledValue = value.digits * 10n ** BigInt(scale - value.scale);
  const scaledStep = step.digits * 10n ** BigInt(scale - step.scale);
  const quotient = (scaledValue * 2n + scaledStep) / (scaledStep * 2n);
  const units = quotient * step.digits;
  if (units === 0n) return "0";
  const body = units.toString().padStart(step.scale + 1, "0");
  const rounded = step.scale === 0 ? body : `${body.slice(0, -step.scale)}.${body.slice(-step.scale)}`;
  return value.negative ? `-${rounded}` : rounded;
};

/**
 * Decodes one base64url part of a JWT as JSON.
 *
 * @param part - The base64url text.
 * @returns The parsed value; `undefined` when it is not valid base64url JSON.
 */
const base64UrlJson = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
};

/** Whether a value is a JSON primitive that is safe to show (a finite number, string, boolean or `null`). */
const isJsonPrimitive = (value: unknown): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

/**
 * The primitive entries of a decoded JWT part, restricted to `names` (all primitive entries without `names`).
 *
 * @param source - The decoded header or payload.
 * @param names - The entries to keep; `undefined` keeps every entry.
 * @returns A new object; a non-primitive entry is shown as `"?"`.
 */
const pickPrimitives = (source: unknown, names: readonly string[] | undefined): { [key: string]: SensitiveJson } => {
  const picked: { [key: string]: SensitiveJson } = {};
  if (source === null || typeof source !== "object" || Array.isArray(source)) return picked;
  const record = source as Record<string, unknown>;
  for (const key of names ?? Object.keys(record)) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    /* A claim that is an object or an array may carry anything: only its presence is shown. */
    Object.defineProperty(picked, key, {
      value: isJsonPrimitive(value) ? value : MASKED,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return picked;
};

/**
 * The 8 hextets of an IPv6 address.
 *
 * @param address - The address text (a zone id after `%` is ignored).
 * @returns The 8 numbers; `undefined` when the text is not an IPv6 address.
 */
const hextetsOf = (address: string): number[] | undefined => {
  const zone = address.indexOf("%");
  const bare = zone === -1 ? address : address.slice(0, zone);
  const gap = bare.indexOf("::");
  if (gap !== -1 && bare.indexOf("::", gap + 1) !== -1) return undefined;
  const split = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = split(gap === -1 ? bare : bare.slice(0, gap));
  const tail = gap === -1 ? [] : split(bare.slice(gap + 2));
  const parts = [...head, ...tail];
  /* An embedded IPv4 tail (`::ffff:1.2.3.4`) takes two hextets. */
  const last = parts[parts.length - 1];
  let embedded: number[] = [];
  if (last?.includes(".")) {
    const octets = ipv4Of(last);
    if (octets === undefined) return undefined;
    parts.pop();
    embedded = [
      ((octets[0] as number) << 8) | (octets[1] as number),
      ((octets[2] as number) << 8) | (octets[3] as number),
    ];
  }
  const values: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 4) return undefined;
    for (let index = 0; index < part.length; index++) if (!isHexDigit(part.charCodeAt(index))) return undefined;
    values.push(Number.parseInt(part, 16));
  }
  const count = values.length + embedded.length;
  if (gap === -1 ? count !== 8 : count > 7) return undefined;
  const headCount = gap === -1 ? values.length : Math.min(head.length, values.length);
  const zeros = new Array<number>(8 - count).fill(0);
  return [...values.slice(0, headCount), ...zeros, ...values.slice(headCount), ...embedded];
};

/**
 * The 4 octets of an IPv4 address.
 *
 * @param address - The address text.
 * @returns The 4 numbers; `undefined` when the text is not an IPv4 address.
 */
const ipv4Of = (address: string): number[] | undefined => {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return undefined;
    for (let index = 0; index < part.length; index++) if (!isDigit(part.charCodeAt(index))) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    octets.push(octet);
  }
  return octets;
};

/**
 * The runtime type name shown by `Mask.type`.
 *
 * @param value - Any value.
 * @returns `"null"`, `"array"`, `"Date"`, `"Map"`, a BSON tag, a `typeof` name, or `"object"`.
 */
const typeName = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object") return typeof value;
  if (BsonGuards.isDate(value)) return "Date";
  if (BsonGuards.isMap(value)) return "Map";
  const tag = BsonGuards.tagOf(value);
  if (tag !== undefined) return tag;
  return "object";
};

/**
 * The `"show"` choice of `Mask.when`: hands the real value back.
 *
 * @param value - The value to show.
 * @returns The same value, typed as JSON.
 */
const show = <T>(value: T): SensitiveJson =>
  /* The cast is deliberate: "show" hands the real value back, exactly as the field mode "show" does; the output
     point (audit trail, event summary) serializes it the same way it serializes any shown value. */
  value as unknown as SensitiveJson;

/**
 * Ready-made masks for the option `sensitive` (and the query `.mask()`): `Mask.email()`, `Mask.card()`,
 * `Mask.hmac({ key })`, … Each returns `{ mask }` typed by the value it accepts. A mask never throws on data
 * (`null` or a wrong value → `"?"`); invalid factory arguments throw `ConfigurationError` at once.
 */
export class Mask {
  /** Not constructible: the class is only a namespace of factories. */
  private constructor() {}

  /**
   * Keeps the first `start` and last `end` characters (code points) and replaces the middle; a string that is
   * too short to hide anything gives `"?"`.
   *
   * @param options - `start` and `end` (default 2 each) and the fill `char` (default `"*"`).
   * @returns A mask for strings.
   * @throws {ConfigurationError} When `start` or `end` is not a non-negative integer or `char` is not one character.
   * @example
   * ```ts
   * Mask.keep().mask("abcdefgh"); // "ab****gh"
   * Mask.keep({ start: 1, end: 0, char: "#" }).mask("secret"); // "s#####"
   * Mask.keep().mask("abcd"); // "?"
   * ```
   */
  static keep(
    options: { readonly start?: number; readonly end?: number; readonly char?: string } = {},
  ): MaskOf<string> {
    const start = requireCount("keep", "start", options.start ?? 2);
    const end = requireCount("keep", "end", options.end ?? 2);
    const char = requireChar("keep", options.char ?? "*");
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        const count = codePoints(value);
        if (count <= start + end) return MASKED;
        return (
          value.slice(0, indexAfter(value, start)) +
          char.repeat(count - start - end) +
          value.slice(indexBeforeLast(value, end))
        );
      },
    };
  }

  /**
   * Keeps the first character of the local part; the domain is kept unless `domain: false`, which keeps only
   * the last dot suffix. Text without a usable `@` gives `"?"`.
   *
   * @param options - `domain: false` hides the domain name too (default `true`).
   * @returns A mask for strings.
   * @example
   * ```ts
   * Mask.email().mask("alice@gmail.com"); // "a***@gmail.com"
   * Mask.email({ domain: false }).mask("alice@gmail.com"); // "a***@***.com"
   * ```
   */
  static email(options: { readonly domain?: boolean } = {}): MaskOf<string> {
    const domain = options.domain ?? true;
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        const at = value.lastIndexOf("@");
        if (at <= 0 || at === value.length - 1) return MASKED;
        const local = value.slice(0, indexAfter(value, 1));
        if (domain) return `${local}***${value.slice(at)}`;
        const dot = value.lastIndexOf(".");
        return dot > at ? `${local}***@***${value.slice(dot)}` : `${local}***@***`;
      },
    };
  }

  /**
   * Keeps a leading `+`, the first digit and the last 2 digits. There is no national-format handling: only the
   * digits count. Fewer than 5 digits give `"?"`.
   *
   * @returns A mask for strings.
   * @example
   * ```ts
   * Mask.phone().mask("+79161234567"); // "+7********67"
   * ```
   */
  static phone(): MaskOf<string> {
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        const digits = digitsOf(value);
        if (digits.length < 5) return MASKED;
        const plus = value.charCodeAt(indexOfFirstNonSpace(value)) === 43 ? "+" : "";
        return `${plus}${digits[0] as string}${"*".repeat(digits.length - 3)}${digits.slice(-2)}`;
      },
    };
  }

  /**
   * Keeps only the last 4 digits of a card number (separators are dropped); fewer than 8 digits give `"?"`.
   *
   * @returns A mask for strings.
   * @example
   * ```ts
   * Mask.card().mask("4242 4242 4242 4242"); // "************4242"
   * ```
   */
  static card(): MaskOf<string> {
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        const digits = digitsOf(value);
        if (digits.length < 8) return MASKED;
        return "*".repeat(digits.length - 4) + digits.slice(-4);
      },
    };
  }

  /**
   * Keeps the country code and check digits (first 4) and the last 4 characters; spaces are dropped. Eight
   * characters or fewer give `"?"`.
   *
   * @returns A mask for strings.
   * @example
   * ```ts
   * Mask.iban().mask("DE89370400440532013000"); // "DE89**************3000"
   * ```
   */
  static iban(): MaskOf<string> {
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        let compact = "";
        for (let index = 0; index < value.length; index++)
          if (!isSpace(value.charCodeAt(index))) compact += value[index];
        if (compact.length <= 8) return MASKED;
        return compact.slice(0, 4) + "*".repeat(compact.length - 8) + compact.slice(-4);
      },
    };
  }

  /**
   * The first code point of every word, each followed by a dot; text without a word gives `"?"`.
   *
   * @returns A mask for strings.
   * @example
   * ```ts
   * Mask.initials().mask("Иван Петров"); // "И. П."
   * ```
   */
  static initials(): MaskOf<string> {
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        const letters: string[] = [];
        let inWord = false;
        for (let index = 0; index < value.length; index++) {
          const code = value.charCodeAt(index);
          if (isSpace(code)) {
            inWord = false;
            continue;
          }
          const pair = isHigh(code) && isLow(value.charCodeAt(index + 1));
          if (!inWord) letters.push(`${value.slice(index, index + (pair ? 2 : 1))}.`);
          inWord = true;
          if (pair) index++;
        }
        return letters.length === 0 ? MASKED : letters.join(" ");
      },
    };
  }

  /**
   * The first `length` characters and the full length of the string (in code points).
   *
   * @param length - How many leading characters to show.
   * @returns A mask for strings.
   * @throws {ConfigurationError} When `length` is not a non-negative integer.
   * @example
   * ```ts
   * Mask.truncate(3).mask("abcdefgh"); // "abc…(8)"
   * ```
   */
  static truncate(length: number): MaskOf<string> {
    const keep = requireCount("truncate", "length", length);
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        return `${value.slice(0, indexAfter(value, keep))}…(${codePoints(value)})`;
      },
    };
  }

  /**
   * The prefix (up to the last `_`) and the last `tail` characters of the secret part. When the tail would
   * be more than a third of the secret, only the prefix is shown.
   *
   * @param options - `tail`: how many trailing characters to show (default 3).
   * @returns A mask for strings.
   * @throws {ConfigurationError} When `tail` is not a non-negative integer.
   * @example
   * ```ts
   * Mask.token().mask("sk_live_51HxAbCdEfGhIj9fQ"); // "sk_live_…9fQ"
   * Mask.token().mask("sk_live_abc"); // "sk_live_…"
   * ```
   */
  static token(options: { readonly tail?: number } = {}): MaskOf<string> {
    const tail = requireCount("token", "tail", options.tail ?? 3);
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        const prefixEnd = value.lastIndexOf("_") + 1;
        const secret = value.slice(prefixEnd);
        /* The tail must stay a minority of the secret, or the mask shows most of it. */
        if (codePoints(secret) < tail * 3 || secret.length === 0)
          return value.length === 0 ? MASKED : `${value.slice(0, prefixEnd)}…`;
        return `${value.slice(0, prefixEnd)}…${secret.slice(indexBeforeLast(secret, tail))}`;
      },
    };
  }

  /**
   * The decoded header and the chosen claims, never the signature. Only primitive values are shown; an object
   * or array claim becomes `"?"`. A malformed token gives `"?"`.
   *
   * @param options - `claims`: the payload entries to show (default `sub` and `exp`).
   * @returns A mask for strings.
   * @example
   * ```ts
   * declare const token: string;
   * Mask.jwt().mask(token); // { header: { alg: "HS256", typ: "JWT" }, claims: { sub: "42", exp: 1900000000 } }
   * ```
   */
  static jwt(options: { readonly claims?: readonly string[] } = {}): MaskOf<string> {
    const claims = [...(options.claims ?? ["sub", "exp"])];
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        const first = value.indexOf(".");
        const second = value.indexOf(".", first + 1);
        if (first <= 0 || second === -1 || value.indexOf(".", second + 1) !== -1) return MASKED;
        const header = base64UrlJson(value.slice(0, first));
        const payload = base64UrlJson(value.slice(first + 1, second));
        if (header === undefined || payload === undefined) return MASKED;
        return { header: pickPrimitives(header, undefined), claims: pickPrimitives(payload, claims) };
      },
    };
  }

  /**
   * Removes the login and password, replaces every query value with `?` and a fragment with `#?`.
   * Text that is not an absolute URL gives `"?"`.
   *
   * @returns A mask for strings.
   * @example
   * ```ts
   * Mask.url().mask("https://bob:pw@example.com/a?token=abc#top"); // "https://example.com/a?token=?#?"
   * ```
   */
  static url(): MaskOf<string> {
    return {
      mask: (value) => {
        if (typeof value !== "string" || !URL.canParse(value)) return MASKED;
        const url = new URL(value);
        let text = `${url.protocol}${url.host === "" ? "" : "//"}${url.host}${url.pathname}`;
        const keys = [...url.searchParams.keys()];
        if (keys.length > 0) text += `?${keys.map((key) => `${encodeURIComponent(key)}=?`).join("&")}`;
        if (url.hash !== "") text += "#?";
        return text;
      },
    };
  }

  /**
   * IPv4: the last octet becomes 0. IPv6: only the /48 prefix is kept. Text that is not an address gives `"?"`.
   *
   * @returns A mask for strings.
   * @example
   * ```ts
   * Mask.ip().mask("10.1.2.3"); // "10.1.2.0"
   * Mask.ip().mask("2001:db8:1:2::9"); // "2001:db8:1::"
   * ```
   */
  static ip(): MaskOf<string> {
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        if (value.includes(":")) {
          const hextets = hextetsOf(value);
          return hextets === undefined
            ? MASKED
            : `${hextets
                .slice(0, 3)
                .map((part) => part.toString(16))
                .join(":")}::`;
        }
        const octets = ipv4Of(value);
        return octets === undefined ? MASKED : `${octets[0] as number}.${octets[1] as number}.${octets[2] as number}.0`;
      },
    };
  }

  /**
   * A keyed HMAC-SHA256 (`h:<hex prefix>`): equal values give equal marks, so values can be correlated without
   * being shown. The key belongs to the mask: there is no global key.
   *
   * @param options - `key`: the secret (string or bytes, copied at once); `length`: hex characters kept (1..64,
   * default 16).
   * @returns A mask for strings.
   * @throws {ConfigurationError} When the key is missing or empty, or `length` is outside 1..64.
   * @example
   * ```ts
   * Mask.hmac({ key: "pepper" }).mask("alice"); // "h:" + 16 hex characters, the same for the same input
   * ```
   */
  static hmac(options: { readonly key: string | Uint8Array; readonly length?: number }): MaskOf<string> {
    const key: unknown = options?.key;
    if (!(typeof key === "string" || key instanceof Uint8Array) || key.length === 0) {
      throw new ConfigurationError(
        "Mask.hmac: a non-empty `key` (string or bytes) is required; there is no global key",
      );
    }
    const length = requireCount("hmac", "length", options.length ?? 16);
    if (length < 1 || length > 64) {
      throw new ConfigurationError(`Mask.hmac: "length" must be 1..64 hex characters, got ${length}`);
    }
    /* A private copy: a caller mutating its buffer later must not change the marks. */
    const secret = typeof key === "string" ? key : Uint8Array.from(key);
    return {
      mask: (value) => {
        if (typeof value !== "string") return MASKED;
        return `h:${createHmac("sha256", secret).update(value, "utf8").digest("hex").slice(0, length)}`;
      },
    };
  }

  /**
   * Rounds to the step: numbers → a number; `bigint` → a decimal string (JSON has no bigint); `Decimal128` → an exact
   * decimal string with the step's decimals (no `Number` conversion, so no precision loss). Halves round away
   * from zero.
   *
   * @param step - The rounding step (a positive finite number).
   * @returns A mask for numbers, bigints and `Decimal128`.
   * @throws {ConfigurationError} When `step` is not a positive finite number.
   * @example
   * ```ts
   * Mask.round(100).mask(1234); // 1200
   * Mask.round(0.05).mask(1.26); // 1.25
   * Mask.round(10).mask(15n); // "20"
   * ```
   */
  static round(step: number): MaskOf<RoundableValue> {
    if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) {
      throw new ConfigurationError(`Mask.round: "step" must be a positive finite number, got ${String(step)}`);
    }
    const decimals = Math.min(100, decimalsOf(step));
    const bigStep = Number.isSafeInteger(step) ? BigInt(step) : undefined;
    const exactStep = parseDecimal(String(step));
    const roundNumber = (value: number): SensitiveJson =>
      Number.isFinite(value) ? Number((Math.round(value / step) * step).toFixed(decimals)) : MASKED;
    return {
      mask: (value) => {
        if (typeof value === "number") return roundNumber(value);
        if (typeof value === "bigint") {
          if (bigStep === undefined) return roundNumber(Number(value));
          const half = bigStep / 2n;
          const magnitude = value < 0n ? -value : value;
          const rounded = ((magnitude + half) / bigStep) * bigStep;
          return String(value < 0n ? -rounded : rounded);
        }
        if (BsonGuards.isDecimal128(value)) {
          return exactStep === undefined ? MASKED : roundDecimalText(value.toString(), exactStep);
        }
        return MASKED;
      },
    };
  }

  /**
   * A number becomes the label of the range it falls into; a lower bound belongs to the range it starts.
   *
   * @param bounds - Finite numbers in strictly ascending order (at least one).
   * @returns A mask for numbers.
   * @throws {ConfigurationError} When `bounds` is empty, not finite, or not strictly ascending.
   * @example
   * ```ts
   * const age = Mask.bucket([18, 35, 60]);
   * age.mask(10); // "<18"
   * age.mask(40); // "35–60"
   * age.mask(70); // "60+"
   * ```
   */
  static bucket(bounds: readonly number[]): MaskOf<number> {
    if (!Array.isArray(bounds) || bounds.length === 0) {
      throw new ConfigurationError("Mask.bucket: `bounds` must be a non-empty array of numbers");
    }
    const edges = [...bounds];
    for (let index = 0; index < edges.length; index++) {
      const edge = edges[index] as number;
      if (typeof edge !== "number" || !Number.isFinite(edge) || (index > 0 && edge <= (edges[index - 1] as number))) {
        throw new ConfigurationError("Mask.bucket: `bounds` must be finite numbers in strictly ascending order");
      }
    }
    const labels = [`<${edges[0] as number}`];
    for (let index = 1; index < edges.length; index++)
      labels.push(`${edges[index - 1] as number}–${edges[index] as number}`);
    labels.push(`${edges[edges.length - 1] as number}+`);
    return {
      mask: (value) => {
        if (typeof value !== "number" || Number.isNaN(value)) return MASKED;
        let index = 0;
        while (index < edges.length && value >= (edges[index] as number)) index++;
        return labels[index] as string;
      },
    };
  }

  /**
   * A date becomes its year or month, in UTC; an invalid date gives `"?"`.
   *
   * @param unit - `"year"` or `"month"`.
   * @returns A mask for dates.
   * @throws {ConfigurationError} When `unit` is neither `"year"` nor `"month"`.
   * @example
   * ```ts
   * Mask.date("year").mask(new Date("1990-05-17")); // "1990"
   * Mask.date("month").mask(new Date("1990-05-17")); // "1990-05"
   * ```
   */
  static date(unit: "year" | "month"): MaskOf<Date> {
    if (unit !== "year" && unit !== "month") {
      throw new ConfigurationError(`Mask.date: the unit must be "year" or "month", got ${JSON.stringify(unit)}`);
    }
    return {
      mask: (value) => {
        if (!BsonGuards.isValidDate(value)) return MASKED;
        const year = String(value.getUTCFullYear());
        return unit === "year" ? year : `${year}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
      },
    };
  }

  /**
   * The size only: code points for strings, elements for arrays, maps and sets. Named `size`, not `length`,
   * because a static `length` on a class clashes with `Function.length`.
   *
   * @returns A mask for strings, arrays, maps and sets.
   * @example
   * ```ts
   * Mask.size().mask("secret"); // "<6 chars>"
   * Mask.size().mask([1, 2, 3]); // "<3 items>"
   * ```
   */
  static size(): MaskOf<MeasurableValue> {
    return {
      mask: (value) => {
        if (typeof value === "string") {
          const count = codePoints(value);
          return `<${count} ${count === 1 ? "char" : "chars"}>`;
        }
        let count: number | undefined;
        if (Array.isArray(value)) count = value.length;
        else if (value instanceof Map || value instanceof Set) count = value.size;
        return count === undefined ? MASKED : `<${count} ${count === 1 ? "item" : "items"}>`;
      },
    };
  }

  /**
   * Only whether a value is present: `"<empty>"` for `null`, `undefined`, `""` and an empty array, map or set,
   * `"<set>"` otherwise.
   *
   * @returns A mask for any value.
   * @example
   * ```ts
   * Mask.presence().mask("x"); // "<set>"
   * Mask.presence().mask([]); // "<empty>"
   * ```
   */
  static presence(): MaskOf<unknown> {
    return {
      mask: (value) => {
        if (value === null || value === undefined || value === "") return "<empty>";
        if (Array.isArray(value) && value.length === 0) return "<empty>";
        if ((value instanceof Map || value instanceof Set) && value.size === 0) return "<empty>";
        return "<set>";
      },
    };
  }

  /**
   * The runtime type only.
   *
   * @returns A mask for any value.
   * @example
   * ```ts
   * Mask.type().mask("x"); // "<string>"
   * Mask.type().mask(new Date()); // "<Date>"
   * Mask.type().mask([1]); // "<array>"
   * ```
   */
  static type(): MaskOf<unknown> {
    return { mask: (value) => `<${typeName(value)}>` };
  }

  /**
   * An object, Mixed value or Map keeps its keys; every value becomes `"?"`. Arrays, dates and BSON values
   * give `"?"`.
   *
   * @returns A mask for objects and maps.
   * @example
   * ```ts
   * Mask.keys().mask({ a: 1, b: "x" }); // { a: "?", b: "?" }
   * ```
   */
  static keys(): MaskOf<object> {
    return {
      mask: (value) => {
        if (
          value === null ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          BsonGuards.isBsonValue(value) ||
          BsonGuards.isDate(value)
        ) {
          return MASKED;
        }
        const names = value instanceof Map ? [...value.keys()].map(String) : Object.keys(value);
        const masked: { [key: string]: SensitiveJson } = {};
        for (const name of names) {
          Object.defineProperty(masked, name, { value: MASKED, enumerable: true, writable: true, configurable: true });
        }
        return masked;
      },
    };
  }

  /**
   * Always the same text, whatever the value.
   *
   * @param text - The text to give.
   * @returns A mask for any value.
   * @throws {ConfigurationError} When `text` is not a string.
   * @example
   * ```ts
   * Mask.fixed("[redacted]").mask("anything"); // "[redacted]"
   * ```
   */
  static fixed(text: string): MaskOf<unknown> {
    if (typeof text !== "string") throw new ConfigurationError("Mask.fixed: the text must be a string");
    return { mask: () => text };
  }

  /**
   * Chooses a mask by the value: each branch is `"show"` (the real value), `"mask"` (`"?"`) or another mask.
   * `null` and `undefined` always give `"?"` without calling the predicate.
   *
   * @typeParam T - The type of value the mask accepts.
   * @param predicate - Decides which branch applies.
   * @param then - The branch for a value the predicate accepts.
   * @param otherwise - The branch for any other value.
   * @returns A mask for `T`.
   * @throws {ConfigurationError} When `predicate` is not a function or a branch is not a valid choice.
   * @example
   * ```ts
   * const nick = Mask.when((name: string) => name.length < 4, "show", Mask.keep({ start: 1, end: 0 }));
   * nick.mask("bob"); // "bob"
   * nick.mask("alexander"); // "a********"
   * ```
   */
  static when<T>(predicate: (value: T) => boolean, then: MaskChoice<T>, otherwise: MaskChoice<T>): MaskOf<T> {
    if (typeof predicate !== "function") throw new ConfigurationError("Mask.when: the predicate must be a function");
    const apply = (choice: MaskChoice<T>, name: string): ((value: T) => SensitiveJson) => {
      if (choice === "show") return show;
      if (choice === "mask") return () => MASKED;
      if (choice !== null && typeof choice === "object" && typeof choice.mask === "function") return choice.mask;
      throw new ConfigurationError(`Mask.when: "${name}" must be "show", "mask" or a mask`);
    };
    const onTrue = apply(then, "then");
    const onFalse = apply(otherwise, "otherwise");
    return {
      mask: (value) => {
        if (value === null || value === undefined) return MASKED;
        return predicate(value) ? onTrue(value) : onFalse(value);
      },
    };
  }
}
