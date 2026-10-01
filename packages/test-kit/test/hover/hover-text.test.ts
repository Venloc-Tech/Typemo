/* Tests `HoverText`: `// ^?` marker parsing, whitespace normalization and top-level union sorting. */
import { describe, expect, test } from "bun:test";
import { HoverText } from "../../src/hover/hover-text.ts";

describe("HoverText.markers", () => {
  test("a caret points at the same column of the line above", () => {
    const code = "const value = 1;\n//    ^?\n";
    const [marker] = HoverText.markers(code);
    expect(marker).toEqual({ index: 0, position: 6, line: 1, column: 7 });
    expect(code[marker?.position ?? -1]).toBe("v");
  });

  test("stacked markers skip marker lines and all point at the code line above", () => {
    const code = "const ab = 1;\n//    ^?\n//     ^?\nconst c = 2;\n//    ^?";
    const markers = HoverText.markers(code);
    expect(markers.map((m) => [m.line, m.column])).toEqual([
      [1, 7],
      [1, 8],
      [4, 7],
    ]);
  });

  test("a marker past the end of the line or without a line above is an error", () => {
    expect(() => HoverText.markers("x;\n//        ^?")).toThrow(/past the end of line 1/);
    expect(() => HoverText.markers("// ^?\nconst a = 1;")).toThrow(/no code line above/);
  });

  test("ordinary comments with a caret are not markers", () => {
    expect(HoverText.markers("const a = 1; // ^? trailing\n// see ^? here")).toEqual([]);
  });
});

describe("HoverText.normalize / sortTopLevelUnion", () => {
  test("multi-line quick info equals the one-line form", () => {
    expect(HoverText.normalize("const x: {\n    a: string;\n    b: number;\n}")).toBe(
      "const x: { a: string; b: number; }",
    );
  });

  test("only the top-level union is sorted; nested unions and arrows are untouched", () => {
    expect(HoverText.sortTopLevelUnion("const x: string | null | Date")).toBe("const x: Date | null | string");
    expect(HoverText.sortTopLevelUnion("{ a: b | a; } | null")).toBe("null | { a: b | a; }");
    expect(HoverText.sortTopLevelUnion("type F = ((x: b | a) => void) | 1")).toBe("type F = ((x: b | a) => void) | 1");
    expect(HoverText.sortTopLevelUnion('"b|c" | "a"')).toBe('"a" | "b|c"');
    expect(HoverText.sortTopLevelUnion("string")).toBe("string");
  });
});
