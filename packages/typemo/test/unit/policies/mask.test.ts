/*
 * Every ready-made mask — the documented example, empty / short / unicode input, a wrong runtime type and null
 * (always "?", never a throw), invalid factory arguments (ConfigurationError at once).
 */
import { describe, expect, test } from "bun:test";
import { Decimal128, Long, ObjectId } from "mongodb";
import { ConfigurationError, Mask } from "../../../src/index.ts";

/** Feeds a value of a wrong type: a mask must not throw on data it was not typed for. */
const loose = (mask: { readonly mask: (value: never) => unknown }, value: unknown): unknown =>
  /* cast: the runtime contract is "a wrong type gives '?'"; the compile-time type forbids exactly this call. */
  (mask.mask as (value: unknown) => unknown)(value);

const WRONG = [null, undefined, 42, true, {}, [], new Date(0)];
const NOT_NUMBER = WRONG.filter((value) => typeof value !== "number");

describe("Mask.keep", () => {
  const mask = Mask.keep();
  test("the example and the defaults (2 + 2, *)", () => {
    expect(mask.mask("abcdefgh")).toBe("ab****gh");
  });
  test("too short → ?", () => {
    expect(mask.mask("")).toBe("?");
    expect(mask.mask("abcd")).toBe("?");
    expect(mask.mask("abcde")).toBe("ab*de");
  });
  test("code points: an emoji is never cut", () => {
    expect(mask.mask("😀😁abc😂😃")).toBe("😀😁***😂😃");
    expect(Mask.keep({ start: 1, end: 0, char: "•" }).mask("🙂xyz")).toBe("🙂•••");
  });
  test("options", () => {
    expect(Mask.keep({ start: 0, end: 4, char: "#" }).mask("123456789")).toBe("#####6789");
  });
  test("wrong type → ?", () => {
    for (const value of WRONG) expect(loose(mask, value)).toBe("?");
  });
  test("invalid factory arguments", () => {
    expect(() => Mask.keep({ start: -1 })).toThrow(ConfigurationError);
    expect(() => Mask.keep({ end: 1.5 })).toThrow(ConfigurationError);
    expect(() => Mask.keep({ char: "" })).toThrow(ConfigurationError);
    expect(() => Mask.keep({ char: "**" })).toThrow(ConfigurationError);
  });
});

describe("Mask.email", () => {
  test("the examples", () => {
    expect(Mask.email().mask("alice@gmail.com")).toBe("a***@gmail.com");
    expect(Mask.email({ domain: false }).mask("alice@gmail.com")).toBe("a***@***.com");
    expect(Mask.email({ domain: false }).mask("alice@localhost")).toBe("a***@***");
  });
  test("unicode local part, quoted @ (the last @ is the separator)", () => {
    expect(Mask.email().mask("😀bob@x.io")).toBe("😀***@x.io");
    expect(Mask.email().mask('"a@b"@x.io')).toBe('"***@x.io');
  });
  test("not an address → ?", () => {
    for (const value of ["", "alice", "@x.io", "alice@"]) expect(Mask.email().mask(value)).toBe("?");
    for (const value of WRONG) expect(loose(Mask.email(), value)).toBe("?");
  });
});

describe("Mask.phone", () => {
  test("country digit + last 2, separators ignored", () => {
    expect(Mask.phone().mask("+79161234567")).toBe("+7********67");
    expect(Mask.phone().mask("+7 (916) 123-45-67")).toBe("+7********67");
    expect(Mask.phone().mask("89161234567")).toBe("8********67");
  });
  test("too few digits / wrong type → ?", () => {
    expect(Mask.phone().mask("")).toBe("?");
    expect(Mask.phone().mask("+1234")).toBe("?");
    for (const value of WRONG) expect(loose(Mask.phone(), value)).toBe("?");
  });
});

describe("Mask.card", () => {
  test("last 4", () => {
    expect(Mask.card().mask("4242424242424242")).toBe("************4242");
    expect(Mask.card().mask("4242 4242 4242 4242")).toBe("************4242");
  });
  test("short / wrong → ?", () => {
    expect(Mask.card().mask("1234567")).toBe("?");
    expect(Mask.card().mask("")).toBe("?");
    for (const value of WRONG) expect(loose(Mask.card(), value)).toBe("?");
  });
});

describe("Mask.iban", () => {
  test("country, check digits, last 4", () => {
    expect(Mask.iban().mask("DE89370400440532013000")).toBe("DE89**************3000");
    expect(Mask.iban().mask("DE89 3704 0044 0532 0130 00")).toBe("DE89**************3000");
  });
  test("short / wrong → ?", () => {
    expect(Mask.iban().mask("DE891234")).toBe("?");
    for (const value of WRONG) expect(loose(Mask.iban(), value)).toBe("?");
  });
});

describe("Mask.initials", () => {
  test("words → initials", () => {
    expect(Mask.initials().mask("Иван Петров")).toBe("И. П.");
    expect(Mask.initials().mask("  anna   maria\tkarenina ")).toBe("a. m. k.");
    expect(Mask.initials().mask("😀mile Zola")).toBe("😀. Z.");
  });
  test("empty / blank / wrong → ?", () => {
    expect(Mask.initials().mask("")).toBe("?");
    expect(Mask.initials().mask("   ")).toBe("?");
    for (const value of WRONG) expect(loose(Mask.initials(), value)).toBe("?");
  });
});

describe("Mask.truncate", () => {
  test("first n + length in code points", () => {
    expect(Mask.truncate(3).mask("abcdefgh")).toBe("abc…(8)");
    expect(Mask.truncate(1).mask("😀😁")).toBe("😀…(2)");
    expect(Mask.truncate(0).mask("secret")).toBe("…(6)");
    expect(Mask.truncate(5).mask("")).toBe("…(0)");
  });
  test("wrong type / bad n", () => {
    for (const value of WRONG) expect(loose(Mask.truncate(2), value)).toBe("?");
    expect(() => Mask.truncate(-1)).toThrow(ConfigurationError);
    expect(() => Mask.truncate(Number.NaN)).toThrow(ConfigurationError);
  });
});

describe("Mask.token", () => {
  test("prefix + tail", () => {
    expect(Mask.token().mask("sk_live_51HxAbCdEf9fQ")).toBe("sk_live_…9fQ");
    expect(Mask.token().mask("abcdefghijk")).toBe("…ijk");
  });
  test("a short secret shows no tail; empty / wrong → ?", () => {
    expect(Mask.token().mask("sk_live_abc")).toBe("sk_live_…");
    expect(Mask.token().mask("")).toBe("?");
    for (const value of WRONG) expect(loose(Mask.token(), value)).toBe("?");
    expect(() => Mask.token({ tail: -2 })).toThrow(ConfigurationError);
  });
});

describe("Mask.jwt", () => {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "u1", exp: 1700000000, email: "a@b.c", roles: ["x"] })}.SIGNATURE`;
  test("header + sub/exp, never the signature or other claims", () => {
    expect(Mask.jwt().mask(token)).toEqual({
      header: { alg: "HS256", typ: "JWT" },
      claims: { sub: "u1", exp: 1700000000 },
    });
    expect(JSON.stringify(Mask.jwt().mask(token))).not.toContain("SIGNATURE");
  });
  test("chosen claims; a non-primitive claim → ?", () => {
    expect(Mask.jwt({ claims: ["roles", "missing"] }).mask(token)).toEqual({
      header: { alg: "HS256", typ: "JWT" },
      claims: { roles: "?" },
    });
  });
  test("not a JWT → ?", () => {
    for (const value of ["", "a.b", "a.b.c.d", "!!!.###.x", `${part({ a: 1 })}.notjson.x`]) {
      expect(Mask.jwt().mask(value)).toBe("?");
    }
    for (const value of WRONG) expect(loose(Mask.jwt(), value)).toBe("?");
  });
  test("a __proto__ claim does not pollute", () => {
    const evil = `${part({ alg: "x" })}.${Buffer.from('{"__proto__":{"polluted":1},"sub":"s"}').toString("base64url")}.s`;
    const result = Mask.jwt({ claims: ["__proto__", "sub"] }).mask(evil) as { claims: Record<string, unknown> };
    expect(result.claims.sub).toBe("s");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("Mask.url", () => {
  test("credentials removed, query values ?, fragment #?", () => {
    expect(Mask.url().mask("https://user:pw@example.com:8443/a/b?token=abc&x=1#frag")).toBe(
      "https://example.com:8443/a/b?token=?&x=?#?",
    );
    expect(Mask.url().mask("mongodb://root:secret@db.local/app")).toBe("mongodb://db.local/app");
  });
  test("not a URL / wrong → ?", () => {
    expect(Mask.url().mask("")).toBe("?");
    expect(Mask.url().mask("not a url")).toBe("?");
    for (const value of WRONG) expect(loose(Mask.url(), value)).toBe("?");
  });
});

describe("Mask.ip", () => {
  test("IPv4 → last octet 0", () => {
    expect(Mask.ip().mask("192.168.10.42")).toBe("192.168.10.0");
  });
  test("IPv6 → /48", () => {
    expect(Mask.ip().mask("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("2001:db8:85a3::");
    expect(Mask.ip().mask("2001:db8::1")).toBe("2001:db8:0::");
    expect(Mask.ip().mask("::1")).toBe("0:0:0::");
    expect(Mask.ip().mask("fe80::1%eth0")).toBe("fe80:0:0::");
    expect(Mask.ip().mask("::ffff:10.0.0.1")).toBe("0:0:0::");
  });
  test("invalid / wrong → ?", () => {
    for (const value of ["", "1.2.3", "256.1.1.1", "1.2.3.x", "1::2::3", "12345::", "g::1", "1:2:3:4:5:6:7:8:9"]) {
      expect(Mask.ip().mask(value)).toBe("?");
    }
    for (const value of WRONG) expect(loose(Mask.ip(), value)).toBe("?");
  });
});

describe("Mask.hmac", () => {
  test("deterministic, keyed, h:<hex>", () => {
    const a = Mask.hmac({ key: "k1" });
    expect(a.mask("alice")).toBe(a.mask("alice"));
    expect(a.mask("alice")).toMatch(/^h:[0-9a-f]{16}$/);
    expect(a.mask("alice")).not.toBe(a.mask("bob"));
    expect(Mask.hmac({ key: "k2" }).mask("alice")).not.toBe(a.mask("alice"));
    expect(Mask.hmac({ key: new TextEncoder().encode("k1") }).mask("alice")).toBe(a.mask("alice"));
    expect(Mask.hmac({ key: "k1", length: 64 }).mask("")).toMatch(/^h:[0-9a-f]{64}$/);
  });
  test("the key buffer is copied at factory time", () => {
    const bytes = new TextEncoder().encode("k1");
    const mask = Mask.hmac({ key: bytes });
    const before = mask.mask("alice");
    bytes[0] = 0;
    expect(mask.mask("alice")).toBe(before);
  });
  test("no key → ConfigurationError; bad length", () => {
    // @ts-expect-error the key is required (there is no global key)
    expect(() => Mask.hmac({})).toThrow(ConfigurationError);
    expect(() => Mask.hmac({ key: "" })).toThrow(ConfigurationError);
    // @ts-expect-error the options object is required
    expect(() => Mask.hmac()).toThrow(ConfigurationError);
    expect(() => Mask.hmac({ key: "k", length: 0 })).toThrow(ConfigurationError);
    expect(() => Mask.hmac({ key: "k", length: 65 })).toThrow(ConfigurationError);
  });
  test("wrong type → ?", () => {
    for (const value of WRONG) expect(loose(Mask.hmac({ key: "k" }), value)).toBe("?");
  });
});

describe("Mask.round", () => {
  test("numbers, without float noise", () => {
    expect(Mask.round(10).mask(1234)).toBe(1230);
    expect(Mask.round(0.1).mask(0.29)).toBe(0.3);
    expect(Mask.round(0.05).mask(1.26)).toBe(1.25);
    expect(Mask.round(1000).mask(-1600)).toBe(-2000);
  });
  test("bigint → string, Decimal128 → exact string", () => {
    expect(Mask.round(100).mask(12345678901234567890n)).toBe("12345678901234567900");
    expect(Mask.round(100).mask(-150n)).toBe("-200");
    expect(Mask.round(0.5).mask(10n)).toBe(10);
    expect(Mask.round(10).mask(Decimal128.fromString("1234.56"))).toBe("1230");
  });
  test("Decimal128 is rounded on its decimal string, without Number precision loss", () => {
    const d = (text: string) => Decimal128.fromString(text);
    /* Beyond 2^53: Number("9007199254740993.4") would give 9007199254740992. */
    expect(Mask.round(1).mask(d("9007199254740993.4"))).toBe("9007199254740993");
    expect(Mask.round(10).mask(d("123456789012345678901234567890125"))).toBe("123456789012345678901234567890130");
    /* Many decimals: 34 significant digits survive. */
    expect(Mask.round(0.0000000001).mask(d("0.1234567890123456789012345678901234"))).toBe("0.1234567890");
    expect(Mask.round(0.05).mask(d("1.26"))).toBe("1.25");
    expect(Mask.round(0.05).mask(d("-1.275"))).toBe("-1.30");
    expect(Mask.round(1e-7).mask(d("0.00000015"))).toBe("0.0000002");
    expect(Mask.round(1000).mask(d("1.5E+3"))).toBe("2000");
    expect(Mask.round(100).mask(d("-1E-30"))).toBe("0");
    expect(Mask.round(1).mask(d("-0"))).toBe("0");
  });
  test("Decimal128 NaN / Infinity → ?", () => {
    expect(Mask.round(1).mask(Decimal128.fromString("NaN"))).toBe("?");
    expect(Mask.round(1).mask(Decimal128.fromString("Infinity"))).toBe("?");
    expect(Mask.round(1).mask(Decimal128.fromString("-Infinity"))).toBe("?");
  });
  test("NaN / wrong → ?; bad step", () => {
    expect(Mask.round(1).mask(Number.NaN)).toBe("?");
    for (const value of [...NOT_NUMBER, "12", Long.fromNumber(3)]) expect(loose(Mask.round(1), value)).toBe("?");
    for (const step of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => Mask.round(step)).toThrow(ConfigurationError);
    }
  });
});

describe("Mask.bucket", () => {
  const mask = Mask.bucket([18, 35, 60]);
  test("ranges", () => {
    expect(mask.mask(10)).toBe("<18");
    expect(mask.mask(18)).toBe("18–35");
    expect(mask.mask(40)).toBe("35–60");
    expect(mask.mask(60)).toBe("60+");
    expect(mask.mask(Number.POSITIVE_INFINITY)).toBe("60+");
  });
  test("NaN / wrong → ?; bad bounds", () => {
    expect(mask.mask(Number.NaN)).toBe("?");
    for (const value of NOT_NUMBER) expect(loose(mask, value)).toBe("?");
    expect(() => Mask.bucket([])).toThrow(ConfigurationError);
    expect(() => Mask.bucket([3, 3])).toThrow(ConfigurationError);
    expect(() => Mask.bucket([5, 1])).toThrow(ConfigurationError);
    expect(() => Mask.bucket([Number.NaN])).toThrow(ConfigurationError);
  });
  test("the bounds array is copied", () => {
    const bounds = [10, 20];
    const own = Mask.bucket(bounds);
    bounds[0] = 100;
    expect(own.mask(15)).toBe("10–20");
  });
});

describe("Mask.date", () => {
  const date = new Date(Date.UTC(1990, 4, 17, 23, 30));
  test("year / month in UTC", () => {
    expect(Mask.date("year").mask(date)).toBe("1990");
    expect(Mask.date("month").mask(date)).toBe("1990-05");
  });
  test("invalid date / wrong → ?; bad unit", () => {
    expect(Mask.date("year").mask(new Date(Number.NaN))).toBe("?");
    for (const value of [null, undefined, "1990-05-17", 0]) expect(loose(Mask.date("month"), value)).toBe("?");
    // @ts-expect-error "day" is not a unit
    expect(() => Mask.date("day")).toThrow(ConfigurationError);
  });
});

describe("Mask.size (length)", () => {
  test("chars in code points, items", () => {
    expect(Mask.size().mask("secret")).toBe("<6 chars>");
    expect(Mask.size().mask("😀")).toBe("<1 char>");
    expect(Mask.size().mask("")).toBe("<0 chars>");
    expect(Mask.size().mask([1, 2, 3])).toBe("<3 items>");
    expect(Mask.size().mask(new Map([["a", 1]]))).toBe("<1 item>");
    expect(Mask.size().mask(new Set())).toBe("<0 items>");
  });
  test("wrong → ?", () => {
    for (const value of [null, undefined, 5, {}]) expect(loose(Mask.size(), value)).toBe("?");
  });
});

describe("Mask.presence / type / keys / fixed", () => {
  test("presence", () => {
    for (const value of [null, undefined, "", [], new Map()]) expect(Mask.presence().mask(value)).toBe("<empty>");
    for (const value of ["x", 0, false, [0], {}]) expect(Mask.presence().mask(value)).toBe("<set>");
  });
  test("type", () => {
    const cases: [unknown, string][] = [
      ["s", "<string>"],
      [1, "<number>"],
      [null, "<null>"],
      [undefined, "<undefined>"],
      [new Date(), "<Date>"],
      [new ObjectId(), "<ObjectId>"],
      [[1], "<array>"],
      [{ a: 1 }, "<object>"],
      [1n, "<bigint>"],
      [new Map(), "<Map>"],
    ];
    for (const [value, expected] of cases) expect(Mask.type().mask(value)).toBe(expected);
  });
  test("keys", () => {
    expect(Mask.keys().mask({ a: 1, b: { c: 2 } })).toEqual({ a: "?", b: "?" });
    expect(Mask.keys().mask(new Map([["x", 1]]))).toEqual({ x: "?" });
    expect(Mask.keys().mask({})).toEqual({});
    const proto = Mask.keys().mask(JSON.parse('{"__proto__":1}') as object) as Record<string, unknown>;
    expect(Object.keys(proto)).toEqual(["__proto__"]);
    for (const value of [null, undefined, [1], new Date(), new ObjectId(), "s"]) {
      expect(loose(Mask.keys(), value)).toBe("?");
    }
  });
  test("fixed", () => {
    expect(Mask.fixed("[redacted]").mask("anything")).toBe("[redacted]");
    expect(Mask.fixed("").mask(null)).toBe("");
    // @ts-expect-error the text is a string
    expect(() => Mask.fixed(1)).toThrow(ConfigurationError);
  });
});

describe("Mask.when", () => {
  const mask = Mask.when((value: string) => value.endsWith("@corp.test"), "show", Mask.email());
  test("chooses by the value", () => {
    expect(mask.mask("boss@corp.test")).toBe("boss@corp.test");
    expect(mask.mask("alice@gmail.com")).toBe("a***@gmail.com");
    expect(Mask.when((value: number) => value > 10, "mask", "show").mask(11)).toBe("?");
    expect(Mask.when((value: number) => value > 10, "mask", "show").mask(5)).toBe(5);
  });
  test("null → ? without calling the predicate", () => {
    let calls = 0;
    const counted = Mask.when(
      (_value: string) => {
        calls++;
        return true;
      },
      "show",
      "show",
    );
    expect(counted.mask(null)).toBe("?");
    expect(calls).toBe(0);
  });
  test("bad arguments", () => {
    // @ts-expect-error the predicate is a function
    expect(() => Mask.when("x", "show", "mask")).toThrow(ConfigurationError);
    // @ts-expect-error "hide" is not a choice of when
    expect(() => Mask.when(() => true, "hide", "mask")).toThrow(ConfigurationError);
  });
});

describe("results are JSON", () => {
  test("every mask's result survives JSON round trip", () => {
    const results = [
      Mask.keep().mask("abcdefgh"),
      Mask.jwt().mask(
        `${Buffer.from('{"alg":"x"}').toString("base64url")}.${Buffer.from('{"sub":"s"}').toString("base64url")}.z`,
      ),
      Mask.round(1).mask(5n),
      Mask.keys().mask({ a: 1 }),
      Mask.bucket([1]).mask(2),
    ];
    for (const result of results) expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
