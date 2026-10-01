/*
 * Summarises a .cpuprofile: top functions by self time and by file.
 *
 * Usage: bun scripts/cpuprofile-top.ts <file> [top]
 */

/**
 * One node of the profile's call tree.
 *
 * @example
 * ```ts
 * const node: Node = { id: 1, callFrame: { functionName: "main", url: "", lineNumber: 0 } };
 * ```
 */
interface Node {
  /** Node id, referenced by `samples`. */
  readonly id: number;
  /** The function this node stands for. */
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
  /** Ids of the child nodes. */
  readonly children?: readonly number[];
}

/**
 * The parts of a `.cpuprofile` the script reads.
 *
 * @example
 * ```ts
 * const profile: Profile = { nodes: [], samples: [], timeDeltas: [] };
 * ```
 */
interface Profile {
  /** The call tree nodes. */
  readonly nodes: readonly Node[];
  /** The node id of every sample. */
  readonly samples: readonly number[];
  /** Microseconds since the previous sample. */
  readonly timeDeltas: readonly number[];
}
const file = process.argv[2];
if (file === undefined) throw new Error("usage: cpuprofile-top.ts <file> [top]");
const top = Number(process.argv[3] ?? 25);
const profile = (await Bun.file(file).json()) as Profile;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<number, number>();
for (let k = 0; k < profile.samples.length; k++) {
  const id = profile.samples[k] ?? -1;
  self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[k] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
/**
 * Shortens a script URL for display.
 *
 * @param url - The script URL of a call frame.
 * @returns A package-relative path.
 */
const short = (url: string): string =>
  url.replace(/^.*node_modules\/\.bun\/([^/]+)\/node_modules\//, "$1:").replace(/^.*\/packages\//, "packages/");
const fn = new Map<string, number>();
const area = new Map<string, number>();
for (const [id, us] of self) {
  const f = byId.get(id)?.callFrame;
  if (f === undefined) continue;
  const key = `${f.functionName || "(anon)"}  ${short(f.url)}:${f.lineNumber + 1}`;
  fn.set(key, (fn.get(key) ?? 0) + us);
  const a = f.url === "" ? "(native/gc/idle)" : short(f.url).split("/").slice(0, 4).join("/");
  area.set(a, (area.get(a) ?? 0) + us);
}
/**
 * Formats a time as a share of the total.
 *
 * @param us - Microseconds.
 * @returns A right-aligned percentage.
 */
const pct = (us: number): string => `${((us / total) * 100).toFixed(1).padStart(5)}%`;
console.log(`total ${(total / 1000).toFixed(0)} ms sampled`);
console.log("-- by area");
for (const [k, v] of [...area].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${pct(v)}  ${k}`);
console.log("-- by function (self)");
for (const [k, v] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${pct(v)}  ${k}`);
