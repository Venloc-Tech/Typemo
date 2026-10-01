import { expect, test } from "bun:test";

function Double(_target: object, _key: string, desc: PropertyDescriptor): void {
  const original = desc.value as () => number;
  desc.value = function (this: unknown) {
    return original.call(this) * 2;
  };
}

test("legacy decorators are enabled", () => {
  class Sample {
    @Double
    value(): number {
      return 21;
    }
  }

  expect(new Sample().value()).toBe(42);
});
