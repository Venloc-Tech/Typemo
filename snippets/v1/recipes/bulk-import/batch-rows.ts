export const portions = function* <T>(rows: readonly T[], size: number): Generator<{ start: number; rows: readonly T[] }> {
  for (let start = 0; start < rows.length; start += size) {
    yield { start, rows: rows.slice(start, start + size) };
  }
};
