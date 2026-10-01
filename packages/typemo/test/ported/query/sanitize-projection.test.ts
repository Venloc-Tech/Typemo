// ported from mongoose test/query.test.js:3471 "sanitizeProjection option with plus paths (gh-14333) (gh-10243)"
// and test/query.test.js:3457 "sanitizeProjection option (gh-10243)". Mongoose's opt-in `sanitizeProjection`
// SILENTLY rewrites a projection from outside (`+password` → `{ password: 0 }`, `{ email: "$name" }` →
// `{ email: 1 }`). Typemo has no such option: a projection written by the application is typed code, and
// data from outside goes through `untrusted()`, which REFUSES `+path` and `$`-keys — an error
// instead of a silent rewrite (from-mongoose-to-typemo/DIVERGENCES.md L4B-9). The logic kept: a hidden field
// cannot be opened by a projection from outside, and the application's own `+path` still selects it.
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, type Hidden, type Model, Prop, Schema, StrictModeError, untrusted } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema({ collection: "ported_sanitize_projection" })
class Account extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => String)
  email?: string;

  @Prop(() => String, { hidden: true })
  password?: Hidden<string>;
}

const t = ModelLifecycle.useTypemo("ported_sanitize_projection");
let Accounts: Model<Account>;

beforeEach(async () => {
  Accounts = t.connection.model(Account);
  await t.mongo.db.collection("ported_sanitize_projection").deleteMany({});
  await Accounts.create({ name: "test", password: "secret" });
});

// What `?fields=` of a request parses to. The application passes it on typed as a harmless projection (`{ name: 1 }`):
// the type cannot see what the request really holds — exactly the case `untrusted()` is for.
const fromRequest = (json: string): { readonly name: 1 } => JSON.parse(json) as { readonly name: 1 };

describe("sanitizeProjection → untrusted()", () => {
  test("gh-14333: the application's own +password selects the hidden field", async () => {
    const doc = await Accounts.findOne().select({ "+password": true }).orFail();
    expect(doc.password).toBe("secret");
  });

  test("gh-14333: +password from outside is refused (Mongoose: silently turned into { password: 0 })", async () => {
    expect(() => void Accounts.findOne().select(untrusted(fromRequest('{ "+password": true }')))).toThrow(
      StrictModeError,
    );
    expect(() => void Accounts.find().select(untrusted(fromRequest('{ "name": 1, "+password": true }')))).toThrow(
      /"\+password"/,
    );
    // without the projection the field stays hidden, as in Mongoose
    const doc = await Accounts.findOne().orFail();
    expect("password" in doc).toBe(false);
  });

  test("gh-10243: a $-expression from outside is refused (Mongoose: silently turned into 1)", () => {
    // `"$name"` is a VALUE (a string), not a key: `untrusted` lets it through, the projection itself refuses it
    // (only 0/1/true/false, `$slice`, `$elemMatch`), with or without `untrusted`
    const expression = fromRequest('{ "email": "$name" }');
    expect(untrusted(expression)).toBe(expression);
    expect(() => void Accounts.find().select(untrusted(expression))).toThrow(/the value of "email" must be 0, 1/);
    expect(() => void Accounts.find().select(untrusted(fromRequest('{ "email": { "$literal": 1 } }')))).toThrow(
      StrictModeError,
    );
  });
});
