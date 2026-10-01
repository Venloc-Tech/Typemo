/**
 * A twoslash-style `// ^?` marker and the source position it points at.
 *
 * @example
 * ```ts
 * const [first]: HoverMarker[] = HoverText.markers("const x = 1;\n// ^?");
 * ```
 */
export interface HoverMarker {
  /** 0-based index among the markers of the source, in source order. */
  readonly index: number;
  /** Offset in the source the caret points at (the character above the `^`). */
  readonly position: number;
  /** 1-based line and column of that character (for messages). */
  readonly line: number;
  /** 1-based column of that character. */
  readonly column: number;
}

/** Marker parsing and text normalization for hover (quick info) comparisons. */
export class HoverText {
  /** A marker line: only whitespace, `//`, whitespace, then `^?`. */
  private static readonly markerLine = /^(\s*\/\/\s*)\^\?\s*$/;

  /**
   * Finds every `// ^?` line. The caret points at the character in the same column of the nearest
   * preceding line that is not itself a marker (so markers can be stacked under one line).
   *
   * @param code - The snippet.
   * @returns The markers in source order.
   * @throws Error - When a marker has no code line above it or points past the end of that line.
   */
  static markers(code: string): HoverMarker[] {
    const lines = code.split("\n");
    const lineStarts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }
    const markers: HoverMarker[] = [];
    lines.forEach((line, lineIndex) => {
      const match = HoverText.markerLine.exec(line);
      if (!match) return;
      const column = (match[1] ?? "").length;
      let target = lineIndex - 1;
      while (target >= 0 && HoverText.markerLine.test(lines[target] ?? "")) target--;
      const targetLine = lines[target];
      if (target < 0 || targetLine === undefined) {
        throw new Error(`HoverText: marker on line ${lineIndex + 1} has no code line above it`);
      }
      if (column >= targetLine.length) {
        throw new Error(
          `HoverText: marker on line ${lineIndex + 1} points at column ${column + 1}, past the end of line ${target + 1}`,
        );
      }
      markers.push({
        index: markers.length,
        position: (lineStarts[target] ?? 0) + column,
        line: target + 1,
        column: column + 1,
      });
    });
    return markers;
  }

  /**
   * Collapses runs of whitespace (quick info prints object types over several lines, `typeToString`
   * on one) and trims, so `{\n    a: string;\n}` and `{ a: string; }` compare equal.
   *
   * @param text - A type or hover text.
   * @returns The normalized text.
   */
  static normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  /**
   * Sorts the members of the top-level union of a type text (`B | A` → `A | B`). For a hover
   * text (`const x: B | A`, `type T = B | A`) only the part after the first top-level `: ` or ` = `
   * is sorted. Nested unions (inside `{}`, `<>`, `()`, `[]`, strings) are left alone: their order is part of the
   * printed type and sorting them textually would be guesswork.
   *
   * @param text - A type or hover text.
   * @returns The text with the top-level union members sorted; unchanged when there is no union.
   */
  static sortTopLevelUnion(text: string): string {
    const heads = [HoverText.topLevelIndex(text, ": "), HoverText.topLevelIndex(text, " = ")].filter((i) => i !== -1);
    const split = heads.length === 0 ? -1 : Math.min(...heads);
    const head = split === -1 ? "" : text.slice(0, split + (text.startsWith(": ", split) ? 2 : 3));
    const body = text.slice(head.length);
    const members = HoverText.splitTopLevel(body, "|").map((member) => member.trim());
    if (members.length < 2) return text;
    return head + members.sort().join(" | ");
  }

  /** Characters that open a nesting level. */
  private static readonly opening = new Set(["(", "[", "{", "<"]);
  /** Characters that close a nesting level. */
  private static readonly closing = new Set([")", "]", "}", ">"]);

  /**
   * Walks `text` at bracket depth 0 (outside strings), calling `onTopLevel` with each index.
   *
   * @param text - The text to scan.
   * @param onTopLevel - Called per top-level index; returning `true` stops the scan.
   */
  private static scanTopLevel(text: string, onTopLevel: (index: number) => boolean): void {
    let depth = 0;
    let quote: string | undefined;
    for (let i = 0; i < text.length; i++) {
      const char = text[i] ?? "";
      if (quote) {
        if (char === "\\") i++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      /* `=>` is an arrow, not a closing angle bracket. */ else if (char === ">" && text[i - 1] === "=") continue;
      else if (HoverText.opening.has(char)) depth++;
      else if (HoverText.closing.has(char)) depth--;
      else if (depth === 0 && onTopLevel(i)) return;
    }
  }

  /**
   * Index of the first top-level occurrence of a substring.
   *
   * @param text - The text to scan.
   * @param needle - The substring.
   * @returns The index, or `-1`.
   */
  private static topLevelIndex(text: string, needle: string): number {
    let found = -1;
    HoverText.scanTopLevel(text, (i) => {
      if (text.startsWith(needle, i)) {
        found = i;
        return true;
      }
      return false;
    });
    return found;
  }

  /**
   * Splits at every top-level occurrence of a separator character.
   *
   * @param text - The text to split.
   * @param separator - A single character.
   * @returns The parts.
   */
  private static splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let start = 0;
    HoverText.scanTopLevel(text, (i) => {
      if (text[i] === separator) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
      return false;
    });
    parts.push(text.slice(start));
    return parts;
  }
}
