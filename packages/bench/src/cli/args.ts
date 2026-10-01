import { CONTESTANTS, type ContestantId, type GroupId, type SizeName } from "../harness/types.ts";

/** Every valid group letter. */
const GROUPS = "ABCDEFGHIJKLMNOPQR".split("") as GroupId[];
/** Every valid size name. */
const SIZES: readonly SizeName[] = ["T", "S", "M", "L", "XL"];

/** Minimal `--key value` / `--flag` parser (no dependency). */
export class Args {
  /** Options that carry a value. */
  readonly #values = new Map<string, string>();
  /** Options without a value. */
  readonly #flags = new Set<string>();

  /**
   * @param argv - The command-line arguments, without the executable and script.
   */
  constructor(argv: readonly string[]) {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i] ?? "";
      if (!arg.startsWith("--")) continue;
      const [key, inline] = arg.slice(2).split("=", 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (inline !== undefined) this.#values.set(key, inline);
      else if (next !== undefined && !next.startsWith("--")) {
        this.#values.set(key, next);
        i++;
      } else this.#flags.add(key);
    }
  }

  /**
   * The value of an option.
   *
   * @param key - The option name, without `--`.
   * @returns The value, or `undefined` when the option is absent or has none.
   */
  get(key: string): string | undefined {
    return this.#values.get(key);
  }

  /**
   * Tells whether an option was given.
   *
   * @param key - The option name, without `--`.
   * @returns `true` for a flag or an option with a value.
   */
  has(key: string): boolean {
    return this.#flags.has(key) || this.#values.has(key);
  }

  /**
   * A comma-separated option as a list.
   *
   * @param key - The option name, without `--`.
   * @returns The trimmed, non-empty items, or `undefined` when the option is absent.
   */
  list(key: string): string[] | undefined {
    const raw = this.#values.get(key);
    return raw === undefined
      ? undefined
      : raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
  }

  /**
   * The `--suite` groups.
   *
   * @returns The group letters, or `undefined` when the option is absent.
   * @throws Error - When a group is unknown.
   */
  groups(): GroupId[] | undefined {
    const raw = this.list("suite");
    if (raw === undefined) return undefined;
    const out = raw.map((g) => g.toUpperCase());
    for (const g of out) if (!GROUPS.includes(g as GroupId)) throw new Error(`--suite: unknown group ${g} (A–R)`);
    return out as GroupId[];
  }

  /**
   * The `--size` sizes.
   *
   * @returns The sizes, or `undefined` when the option is absent.
   * @throws Error - When a size is unknown.
   */
  sizes(): SizeName[] | undefined {
    const raw = this.list("size");
    if (raw === undefined) return undefined;
    const out = raw.map((s) => s.toUpperCase());
    for (const s of out) if (!SIZES.includes(s as SizeName)) throw new Error(`--size: unknown size ${s} (T,S,M,L,XL)`);
    return out as SizeName[];
  }

  /**
   * The `--contestants` list.
   *
   * @returns The contestant ids, or `undefined` when the option is absent.
   * @throws Error - When a contestant is unknown.
   */
  contestants(): ContestantId[] | undefined {
    const raw = this.list("contestants");
    if (raw === undefined) return undefined;
    for (const c of raw) if (!CONTESTANTS.includes(c as ContestantId)) throw new Error(`--contestants: unknown ${c}`);
    return raw as ContestantId[];
  }
}
