/*
 * TC39 hooks: `this` of a document hook is the hydrated document or subdocument
 * (`HookThis<"document.save", T>` = `HydratedDoc<T> | Subdocument<T>`), so a hook uses `$isNew`/`$isModified` and
 * narrows with `$isRoot()` for `$getChanges`; `this: Account` and an implicit `this` still compile, `this: HydratedDoc<Account>`
 * alone does not (the class may be embedded). The classes are only declared: the run-time behaviour is the core's
 * (the legacy test on the server).
 */
import { describe, expect, test } from "bun:test";
import { Entity, type HookThis, type HydratedDoc, type OperationHookContext } from "@venloc/typemo";
import { Post, Pre, Prop, Schema } from "../../src/index.ts";

describe("TC39 document hooks: this is the hydrated document or subdocument", () => {
  test("this: HookThis<event, T>, this: T and an implicit this compile", () => {
    @Schema({ collection: "tc39_hook_this" })
    class Account extends Entity {
      @Prop(() => String, { required: true }) name!: string;

      @Pre("document.save")
      record(this: HookThis<"document.save", Account>): void {
        void this.$isNew();
        void this.$isModified("name");
        if (this.$isRoot()) void this.$getChanges();
      }

      @Pre("document.save")
      normalize(this: Account): void {
        this.name = this.name.trim();
      }

      @Post("document.save")
      after(): void {}
    }
    expect(typeof Account).toBe("function");
  });

  test("the wrong this is refused", () => {
    const invalid = (): void => {
      @Schema({ collection: "tc39_hook_this_bad" })
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
