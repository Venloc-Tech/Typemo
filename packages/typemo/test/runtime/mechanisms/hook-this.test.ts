/*
 * `this` of a document hook is the hydrated document or, for a class embedded in another, the hydrated subdocument
 * (`HydratedDoc<T> | Subdocument<T>` = `HookThis<"document.save", T>`): `$isNew()` and `$isModified()` work on
 * both, the root-only methods (`$getChanges`) after narrowing. A hook may also declare `this: Account` or leave
 * `this` implicit; `this: HydratedDoc<Account>` alone is refused (the class may be embedded). On the real server,
 * the hook sees the document or subdocument it runs for.
 */
import { describe, expect, test } from "bun:test";
import { expectTypeOf } from "@venloc/typemo-test-kit";
import {
  type DocumentChanges,
  Entity,
  type HookThis,
  type HydratedDoc,
  type OperationHookContext,
  Post,
  Pre,
  Prop,
  Schema,
  type Subdocument,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("w5_hook_this");

/** What the hooks saw, in order. */
const seen: { readonly hook: string; readonly isNew: boolean; readonly changes: DocumentChanges }[] = [];

@Schema({ collection: "w5_hook_this_accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) balance?: number;

  /** The hydrated document or subdocument: `$isNew` on both, `$getChanges` after `$isRoot()` narrowed to the root. */
  @Pre("document.save")
  record(this: HookThis<"document.save", Account>): void {
    seen.push({ hook: "pre", isNew: this.$isNew(), changes: this.$isRoot() ? this.$getChanges() : {} });
  }

  /** The entity type is still accepted. */
  @Pre("document.save")
  normalize(this: Account): void {
    this.name = this.name.trim();
  }

  /** An implicit `this` is still accepted. */
  @Post("document.save")
  after(): void {
    seen.push({ hook: "post", isNew: false, changes: {} });
  }

  /** A document hook registered for a list of events. */
  @Pre(["document.save", "document.validate"])
  both(this: HydratedDoc<Account> | Subdocument<Account>): void {
    void this.$isModified("balance");
  }
}

describe("this of a document hook", () => {
  test("the hook runs with the hydrated document", async () => {
    seen.length = 0;
    const Accounts = t.connection.model(Account);
    const doc = await Accounts.create({ name: "  Ann ", balance: 1 });
    doc.balance = 2;
    await doc.$save();
    expect(seen.map((entry) => [entry.hook, entry.isNew])).toEqual([
      ["pre", true],
      ["post", false],
      ["pre", false],
      ["post", false],
    ]);
    expect(seen[2]?.changes).toEqual({ $set: { balance: 2 } });
    expect(doc.name).toBe("Ann");
  });

  test("the types", () => {
    expectTypeOf<HookThis<"document.save", Account>>().toEqualTypeOf<HydratedDoc<Account> | Subdocument<Account>>();
    expectTypeOf<HookThis<"query.find", Account>>().toEqualTypeOf<OperationHookContext<Account, "query.find">>();
    const invalid = (): void => {
      class Wrong extends Entity {
        // @ts-expect-error — a document hook does not run with the operation context
        @Pre("document.save") context(this: OperationHookContext<Wrong>): void {}
        // @ts-expect-error — a query hook does not run with the hydrated document
        @Pre("query.find") hydrated(this: HydratedDoc<Wrong>): void {}
        // @ts-expect-error — a document hook of a class may run on a subdocument: HydratedDoc alone is too narrow
        @Pre("document.save") rootOnly(this: HydratedDoc<Wrong>): void {}
      }
      void Wrong;
    };
    expect(typeof invalid).toBe("function");
  });
});

/** A line embedded in an order: its document hook runs with the subdocument. */
@Schema()
class Line {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;

  /** What the hook saw on the line. */
  @Pre("document.save")
  check(this: HookThis<"document.save", Line>): void {
    lineSeen.push({
      sku: this.sku,
      isNew: this.$isNew(),
      qty: this.$isModified("qty"),
      any: this.$isModified(),
      root: this.$isRoot(),
    });
  }
}

/** What the line hook saw, in order. */
const lineSeen: { sku: string; isNew: boolean; qty: boolean; any: boolean; root: boolean }[] = [];

@Schema({ collection: "w5_hook_this_orders" })
class Order extends Entity {
  @Prop(() => [Line]) lines!: Line[];
}

describe("this of a document hook of an embedded class", () => {
  test("$isNew and $isModified work on the subdocument (no TypeError)", async () => {
    lineSeen.length = 0;
    const Orders = t.connection.model(Order);
    const order = await Orders.create({ lines: [{ sku: "a", qty: 1 }] });
    expect(lineSeen).toEqual([{ sku: "a", isNew: true, qty: false, any: false, root: false }]);
    lineSeen.length = 0;
    const [line] = order.lines;
    if (line === undefined) throw new Error("the line was not created");
    line.qty = 5;
    await order.$save();
    expect(lineSeen).toEqual([{ sku: "a", isNew: false, qty: true, any: true, root: false }]);
  });

  test("the subdocument methods: $isNew of the owner, $isModified of its own fields", async () => {
    const Orders = t.connection.model(Order);
    const fresh = Orders.new({ lines: [{ sku: "b", qty: 2 }] });
    const [line] = fresh.lines;
    expect(line?.$isNew()).toBe(true);
    expect(line?.$isRoot()).toBe(false);
    expect(fresh.$isRoot()).toBe(true);
    expect(line?.$isModified()).toBe(false);
    await fresh.$save();
    expect(line?.$isNew()).toBe(false);
    line?.$set("sku", "c");
    expect(line?.$isModified("sku")).toBe(true);
    expect(line?.$isModified("qty")).toBe(false);
  });

  test("the types: the common methods on the union, the root ones after narrowing", () => {
    expectTypeOf<Subdocument<Line>["$isNew"]>().toEqualTypeOf<() => boolean>();
    const hook = function (this: HookThis<"document.save", Line>): void {
      void this.$isNew();
      void this.$isModified("qty");
      // @ts-expect-error — not a path of Line
      void this.$isModified("nope");
      // @ts-expect-error — $getChanges is a method of the root document only: narrow first
      void this.$getChanges();
      if (this.$isRoot()) {
        expectTypeOf(this).toEqualTypeOf<HydratedDoc<Line>>();
        void this.$getChanges();
      } else {
        expectTypeOf(this).toEqualTypeOf<Subdocument<Line>>();
      }
    };
    expect(typeof hook).toBe("function");
  });
});
