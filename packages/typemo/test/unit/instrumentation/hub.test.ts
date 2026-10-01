/* Explicit registration, zero cost without subscribers (a plain flag), redaction. */
import { describe, expect, spyOn, test } from "bun:test";
import { ConfigurationError, type InstrumentationEvent, InstrumentationHub } from "../../../src/internal.ts";

const event: InstrumentationEvent = {
  type: "cursor.batch",
  operationId: 1,
  timestamp: 0,
  batch: 0,
  size: 1,
};

describe("InstrumentationHub", () => {
  test("enabled only while a subscriber (own or parent) is registered", () => {
    const parent = new InstrumentationHub(undefined);
    const hub = new InstrumentationHub(parent);
    expect(hub.enabled).toBe(false);
    const own = hub.subscribe({ handle: () => {} });
    expect(hub.enabled).toBe(true);
    own.unsubscribe();
    expect(hub.enabled).toBe(false);
    const inherited = parent.subscribe({ handle: () => {} });
    expect(hub.enabled).toBe(true);
    inherited[Symbol.dispose]();
    expect(hub.enabled).toBe(false);
  });

  test("delivers to own and inherited subscribers; a throwing subscriber is reported, not fatal", () => {
    const parent = new InstrumentationHub(undefined);
    const hub = new InstrumentationHub(parent);
    const got: string[] = [];
    hub.subscribe({ handle: () => got.push("own") });
    hub.subscribe({
      handle: () => {
        throw new Error("adapter bug");
      },
    });
    parent.subscribe({ handle: () => got.push("parent") });
    const report = spyOn(console, "error").mockImplementation(() => {});
    hub.emit(event);
    expect(got).toEqual(["own", "parent"]);
    expect(report).toHaveBeenCalledTimes(1);
    report.mockRestore();
  });

  test("the variant of a subscriber sensitive goes only to it, built once per distinct value", () => {
    const hub = new InstrumentationHub(undefined);
    const redacted: unknown[] = [];
    const full: unknown[] = [];
    const hidden: unknown[] = [];
    const custom: unknown[] = [];
    const fn = { mask: (value: unknown) => String(value) };
    hub.subscribe({ handle: (e) => redacted.push(e) });
    hub.subscribe({ handle: (e) => redacted.push(e), sensitive: "mask" });
    hub.subscribe({ handle: (e) => full.push(e), sensitive: "show" });
    hub.subscribe({ handle: (e) => full.push(e), sensitive: "show" });
    hub.subscribe({ handle: (e) => hidden.push(e), sensitive: "hide" });
    hub.subscribe({ handle: (e) => custom.push(e), sensitive: fn });
    expect(hub.wantsValues).toBe(true);
    const built: unknown[] = [];
    hub.emit(event, (sensitive) => {
      built.push(sensitive);
      return { ...event, size: sensitive === "show" ? 99 : sensitive === "hide" ? 0 : 1 };
    });
    expect(redacted).toEqual([event, event]);
    expect(full).toEqual([
      { ...event, size: 99 },
      { ...event, size: 99 },
    ]);
    expect(hidden).toEqual([{ ...event, size: 0 }]);
    expect(custom).toEqual([{ ...event, size: 1 }]);
    expect(built).toEqual(["show", "hide", fn]);
  });

  test("a wrong subscriber sensitive is a ConfigurationError", () => {
    const hub = new InstrumentationHub(undefined);
    // @ts-expect-error "none" is the removed redaction value, not a sensitive mode
    expect(() => hub.subscribe({ handle: () => {}, sensitive: "none" })).toThrow(ConfigurationError);
    // @ts-expect-error a mask must be a function
    expect(() => hub.subscribe({ handle: () => {}, sensitive: { mask: "?" } })).toThrow(ConfigurationError);
  });

  test("wantsValues is false when every subscriber uses the default mask", () => {
    const hub = new InstrumentationHub(undefined);
    hub.subscribe({ handle: () => {} });
    hub.subscribe({ handle: () => {}, sensitive: "mask" });
    expect(hub.wantsValues).toBe(false);
  });

  test("onChange fires on own and parent changes (clients attach driver listeners by it)", () => {
    const parent = new InstrumentationHub(undefined);
    const hub = new InstrumentationHub(parent);
    let changes = 0;
    const detach = hub.onChange(() => changes++);
    hub.subscribe({ handle: () => {}, driverCommands: true }).unsubscribe();
    parent.subscribe({ handle: () => {} });
    detach();
    parent.subscribe({ handle: () => {} });
    expect(changes).toBe(3);
  });

  test("a subscriber without handle() is refused", () => {
    expect(() => new InstrumentationHub(undefined).subscribe({} as never)).toThrow(/handle/);
  });
});
