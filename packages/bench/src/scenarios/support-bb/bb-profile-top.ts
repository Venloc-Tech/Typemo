/*
 * Summarises a `.cpuprofile` (Chrome/V8 format, as `bun --cpu-prof` writes it): self time and total (inclusive)
 * time per function, top N, with the source file.
 *
 * Usage: bun run bb-profile-top.ts <file.cpuprofile> [N]
 */

/**
 * The function of a profile node.
 *
 * @example
 * ```ts
 * const frame: CallFrame = { functionName: "main", url: "", lineNumber: 0 };
 * ```
 */
interface CallFrame {
  /** The function name. */
  readonly functionName: string;
  /** The script URL. */
  readonly url: string;
  /** 0-based line. */
  readonly lineNumber: number;
}

/**
 * A node of the call tree.
 *
 * @example
 * ```ts
 * const node: ProfileNode = { id: 1, callFrame: frame };
 * ```
 */
interface ProfileNode {
  /** Node id, referenced by `samples`. */
  readonly id: number;
  /** The function of the node. */
  readonly callFrame: CallFrame;
  /** Ids of the child nodes. */
  readonly children?: readonly number[];
}

/**
 * The parts of a `.cpuprofile` the script reads.
 *
 * @example
 * ```ts
 * const profile: CpuProfile = { nodes: [], samples: [], timeDeltas: [] };
 * ```
 */
interface CpuProfile {
  /** The call tree nodes. */
  readonly nodes: readonly ProfileNode[];
  /** The node id of every sample. */
  readonly samples: readonly number[];
  /** Microseconds since the previous sample. */
  readonly timeDeltas: readonly number[];
}

/** Summarises a CPU profile. */
class ProfileTop {
  /**
   * A short label of a function.
   *
   * @param frame - The call frame.
   * @returns `name file:line`.
   */
  static label(frame: CallFrame): string {
    const file = frame.url.replace(/^.*\/packages\//, "").replace(/^.*node_modules\//, "nm/");
    return `${frame.functionName || "(anonymous)"} ${file}:${frame.lineNumber + 1}`;
  }

  /**
   * Self and inclusive time per function.
   *
   * @param profile - The parsed profile.
   * @param top - How many functions to list per table.
   * @returns The text report.
   */
  static summarise(profile: CpuProfile, top: number): string {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const parent = new Map<number, number>();
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
    const self = new Map<string, number>();
    const total = new Map<string, number>();
    let all = 0;
    profile.samples.forEach((id, i) => {
      const dt = profile.timeDeltas[i] ?? 0;
      all += dt;
      const node = byId.get(id);
      if (node === undefined) return;
      const key = ProfileTop.label(node.callFrame);
      self.set(key, (self.get(key) ?? 0) + dt);
      const seen = new Set<string>();
      for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
        const frame = byId.get(at)?.callFrame;
        if (frame === undefined) break;
        const label = ProfileTop.label(frame);
        if (seen.has(label)) continue;
        seen.add(label);
        total.set(label, (total.get(label) ?? 0) + dt);
      }
    });
    const pct = (us: number): string => `${((us / all) * 100).toFixed(1)}%`;
    const rows = (map: Map<string, number>): string =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([name, us]) => `  ${pct(us).padStart(6)} ${(us / 1000).toFixed(1).padStart(9)} ms  ${name}`)
        .join("\n");
    return `total ${(all / 1000).toFixed(0)} ms\nSELF\n${rows(self)}\nTOTAL (inclusive)\n${rows(total)}`;
  }
}

const [file, n] = process.argv.slice(2);
if (file === undefined) throw new Error("usage: bb-profile-top.ts <file.cpuprofile> [N]");
console.log(ProfileTop.summarise((await Bun.file(file).json()) as CpuProfile, Number(n ?? 20)));
