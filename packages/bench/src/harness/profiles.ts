import type { IterationOverrides } from "./scenario.ts";
import type { GroupId, ProfileName } from "./types.ts";

/**
 * Iteration policy: warmup, then ≥ `minSamples` samples or ≥ `maxTimeMs`, 3 repeats → median of medians.
 *
 * @example
 * ```ts
 * const policy: IterationPolicy = Profiles.get("quick").policy;
 * ```
 */
export interface IterationPolicy {
  /** Untimed warmup iterations. */
  readonly warmup: number;
  /** Samples when one operation is fast enough: 30. */
  readonly minSamples: number;
  /** Fewest samples accepted when `maxTimeMs` is reached first. */
  readonly floorSamples: number;
  /** Fast operations keep sampling until this much measured time (more samples = stabler percentiles). */
  readonly minTimeMs: number;
  /** A slow operation stops after this much measured time (never below `floorSamples`). */
  readonly maxTimeMs: number;
  /** Hard cap on samples. */
  readonly maxSamples: number;
  /** Repeats; the result is the median of the repeats' medians. */
  readonly repeats: number;
}

/**
 * A named run profile.
 *
 * @example
 * ```ts
 * const definition: ProfileDefinition = Profiles.get("standard");
 * ```
 */
export interface ProfileDefinition {
  /** The profile name. */
  readonly name: ProfileName;
  /** What the profile covers. */
  readonly description: string;
  /** The iteration policy. */
  readonly policy: IterationPolicy;
  /** Groups excluded from the profile regardless of scenarios' `profiles` (standard has no Q). */
  readonly excludedGroups: readonly GroupId[];
  /** Budget the CLI warns about (minutes). */
  readonly budgetMinutes: number;
}

/** The policy every profile starts from. */
const BASE: IterationPolicy = {
  warmup: 3,
  minSamples: 30,
  floorSamples: 3,
  minTimeMs: 250,
  maxTimeMs: 2_000,
  maxSamples: 5_000,
  repeats: 3,
};

/** The run profiles. */
export class Profiles {
  /** Every profile by name. */
  static readonly ALL: Readonly<Record<ProfileName, ProfileDefinition>> = {
    quick: {
      name: "quick",
      description: "S only, 1–2 scenarios per group (CI smoke)",
      policy: { ...BASE, warmup: 2, minTimeMs: 100 },
      excludedGroups: [],
      budgetMinutes: 3,
    },
    standard: {
      name: "standard",
      description: "S and M, all groups except O and Q; O shortened",
      /* minTime 150 ms: every fast operation still gets well over 30 samples; the 30-minute budget needs it. */
      policy: { ...BASE, minTimeMs: 150 },
      excludedGroups: ["Q"],
      budgetMinutes: 25,
    },
    full: {
      name: "full",
      description: "Everything including L, full O and R (2–3 h, run by the user)",
      policy: { ...BASE, warmup: 5, floorSamples: 5, minTimeMs: 500, maxTimeMs: 4_000 },
      excludedGroups: [],
      budgetMinutes: 180,
    },
    heavy: {
      name: "heavy",
      description: "L and XL, streaming, Q long-run (2–4 h, run by the user)",
      policy: { ...BASE, warmup: 2, minSamples: 10, floorSamples: 3, minTimeMs: 500, maxTimeMs: 5_000 },
      excludedGroups: [],
      budgetMinutes: 240,
    },
  };

  /**
   * Looks a profile up by name.
   *
   * @param name - The profile name.
   * @returns The profile.
   * @throws Error - When the name is unknown.
   */
  static get(name: string): ProfileDefinition {
    const profile = (Profiles.ALL as Record<string, ProfileDefinition | undefined>)[name];
    if (profile === undefined) throw new Error(`unknown profile "${name}" (quick | standard | full | heavy)`);
    return profile;
  }

  /**
   * The policy of a profile with a scenario's overrides applied.
   *
   * @param profile - The profile.
   * @param overrides - The scenario's overrides.
   * @returns The merged policy.
   */
  static policyFor(profile: ProfileDefinition, overrides: IterationOverrides): IterationPolicy {
    return {
      ...profile.policy,
      ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
    };
  }
}
