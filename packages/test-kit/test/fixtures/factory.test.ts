/* Tests `defineFactory`: sequence-aware defaults and overrides. */
import { expect, test } from "bun:test";
import { defineFactory } from "../../src/fixtures/factory.ts";

/** The entity built by the factories under test. */
interface Widget {
  /** Widget name. */
  name: string;
  /** Quantity. */
  qty: number;
}

test("build() applies sequence-aware defaults and overrides", () => {
  const factory = defineFactory<Widget>((sequence) => ({ name: `widget-${sequence}`, qty: 1 }));

  const first = factory.build();
  const second = factory.build({ qty: 9 });

  expect(first.name).toBe("widget-1");
  expect(second.name).toBe("widget-2");
  expect(second.qty).toBe(9);
});

test("buildMany() produces the requested count, each with a distinct sequence", () => {
  const factory = defineFactory<Widget>((sequence) => ({ name: `widget-${sequence}`, qty: 1 }));

  const batch = factory.buildMany(3);

  expect(batch.map((widget) => widget.name)).toEqual(["widget-1", "widget-2", "widget-3"]);
});
