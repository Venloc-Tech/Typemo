/*
 * Ready-made masks used through the field option `sensitive`, on the real server — the audit trail entry
 * and an instrumentation event show the masked values, never the real ones.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  Entity,
  type InstrumentationEvent,
  Mask,
  type Model,
  type OperationStartEvent,
  Prop,
  Schema,
  type Subscription,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const KEY = "test-hmac-key";

/** An audited entity with one field per ready-made mask. */
@Schema({ collection: "s116_masked", audit: true })
class Masked extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { sensitive: Mask.email() }) email?: string;
  @Prop(() => String, { sensitive: Mask.card() }) card?: string;
  @Prop(() => String, { sensitive: Mask.hmac({ key: KEY, length: 12 }) }) login?: string;
  @Prop(() => Number, { sensitive: Mask.bucket([18, 35, 60]) }) age?: number;
  @Prop(() => Date, { sensitive: Mask.date("year") }) born?: Date;
  @Prop(() => String, { sensitive: Mask.keep({ start: 1, end: 1 }), nullable: true }) nick?: string | null;
}

const t = ModelLifecycle.useTypemo("mask116");
let Model116: Model<Masked>;
let subscription: Subscription | undefined;

beforeEach(() => {
  Model116 = t.connection.model(Masked);
});
afterEach(() => {
  subscription?.unsubscribe();
  subscription = undefined;
});

const DOC = {
  name: "ann",
  email: "alice@gmail.com",
  card: "4242424242424242",
  login: "ann.secret",
  age: 42,
  born: new Date(Date.UTC(1983, 6, 1)),
  nick: null,
};

describe("Mask.* through sensitive", () => {
  test("the audit trail entry holds the masked values", async () => {
    await Model116.create(DOC);
    const entries = await t.mongo.db.collection("s116_masked_audit").find({}).toArray();
    const text = JSON.stringify(entries);
    for (const secret of ["alice@gmail.com", "4242424242424242", "ann.secret", "1983-07"]) {
      expect(text).not.toContain(secret);
    }
    const login = Mask.hmac({ key: KEY, length: 12 }).mask("ann.secret");
    for (const shown of ['"a***@gmail.com"', '"************4242"', `"${String(login)}"`, '"35–60"', '"1983"']) {
      expect(text).toContain(shown);
    }
    expect(text).toContain('"nick":"?"');
  });

  test("an instrumentation event shows the masked filter values", async () => {
    const events: InstrumentationEvent[] = [];
    subscription = t.client.instrument({ handle: (event) => events.push(event), sensitive: "show" });
    await Model116.find({ name: "ann", email: "alice@gmail.com", age: 42, login: "ann.secret" });
    const start = events.find(
      (event): event is OperationStartEvent => event.type === "operation.start" && event.operation === "find",
    );
    const filter = start?.summary.filter as Record<string, unknown>;
    expect(filter.name).toBe("ann");
    expect(filter.email).toBe("a***@gmail.com");
    expect(filter.age).toBe("35–60");
    expect(filter.login).toBe(Mask.hmac({ key: KEY, length: 12 }).mask("ann.secret"));
    expect(JSON.stringify(events)).not.toContain("alice@gmail.com");
  });
});
