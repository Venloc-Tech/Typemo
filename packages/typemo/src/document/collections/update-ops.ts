import { TypemoError } from "../../errors/typemo-error.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import { SchemaWalker } from "../../schema/compiler/schema-walker.ts";
import { type FoundUnknown, type PathPair, TrackedProtocol } from "./tracked-protocol.ts";

/**
 * `$push` / `$addToSet` argument: always the `$each` form (one shape for one or many values).
 *
 * @example
 * ```ts
 * const modifier: EachModifier = { $each: ["a", "b"], $position: 0 };
 * ```
 */
export interface EachModifier {
  /** The values to add. */
  readonly $each: readonly unknown[];
  /** Where to insert them (`$push` only). */
  readonly $position?: number;
}

/**
 * The part of an update that tracked collections produce (the document layer merges its own `$set`/`$unset`).
 *
 * @example
 * ```ts
 * const parts: UpdateParts = { $push: { tags: { $each: ["new"] } } };
 * ```
 */
export interface UpdateParts {
  /** Values to set by path. */
  readonly $set?: Readonly<Record<string, unknown>>;
  /** Paths to remove. */
  readonly $unset?: Readonly<Record<string, "">>;
  /** Values to append by array path. */
  readonly $push?: Readonly<Record<string, EachModifier>>;
  /** Values to add when absent by array path. */
  readonly $addToSet?: Readonly<Record<string, EachModifier>>;
  /** Subdocuments to remove by `_id`, by array path. */
  readonly $pull?: Readonly<Record<string, { readonly _id: { readonly $in: readonly unknown[] } }>>;
  /** Values to remove by array path. */
  readonly $pullAll?: Readonly<Record<string, readonly unknown[]>>;
  /** The end to remove from, by array path: `1` last, `-1` first. */
  readonly $pop?: Readonly<Record<string, 1 | -1>>;
}

/**
 * An update operator of {@link UpdateParts}.
 *
 * @example
 * ```ts
 * const operator: UpdatePartOperator = "$push";
 * ```
 */
export type UpdatePartOperator = keyof UpdateParts;

/**
 * What a change does to the version key (Mongoose `VERSION_WHERE` / `VERSION_INC`):
 * `"where"` — a positional write (`$set path.i…`) that must be guarded by `__v` in the filter;
 * `"increment"` — an operation that changes the array's length or order (atomics, whole `$set`).
 *
 * @example
 * ```ts
 * const impact: VersionImpact = "increment";
 * ```
 */
export type VersionImpact = "none" | "where" | "increment";

/**
 * The ops of one tracked value, its version impact and the code paths it changed.
 *
 * @example
 * ```ts
 * const delta: CollectionDelta = Collections.toUpdateOps(user.tags, "code", { code: "tags", db: "tags" });
 * ```
 */
export interface CollectionDelta {
  /** The update operations. */
  readonly ops: UpdateParts;
  /** The strongest version impact. */
  readonly version: VersionImpact;
  /** The code paths changed. */
  readonly modifiedPaths: readonly string[];
  /**
   * The stored subdocuments with fields unknown to the schema that these ops would rewrite or replace
   * (their unknown fields would be lost). `Collections.toUpdateOps` throws `UnknownFieldsError` for them
   * unless told otherwise.
   */
  readonly unknown: readonly FoundUnknown[];
}

/**
 * The form of the produced ops: database names + encoded BSON values, or code names + plain values.
 *
 * @example
 * ```ts
 * const form: OpsForm = "db";
 * ```
 */
export type OpsForm = "db" | "code";

/** The order of version impacts, from the weakest. */
const RANK: Readonly<Record<VersionImpact, number>> = { none: 0, where: 1, increment: 2 };

/**
 * {@link UpdateParts} while it is being built.
 *
 * @example
 * ```ts
 * const parts: MutableParts = { $set: { name: "Ada" } };
 * ```
 */
type MutableParts = { -readonly [K in UpdatePartOperator]?: Record<string, unknown> };

/** Collects the ops of one delta walk (see `Tracked[DELTA]`). */
export class DeltaBuilder {
  /** The operations collected so far. */
  readonly #parts: MutableParts = {};
  /** The code paths touched. */
  readonly #modified: string[] = [];
  /** The strongest version impact so far. */
  #version: VersionImpact = "none";
  /** Stored subdocuments with unknown fields that the ops would lose. */
  readonly #unknown: FoundUnknown[] = [];
  /** Found by `value()` for the op `add()` records next (relative paths, prefixed there). */
  #pending: FoundUnknown[] = [];

  /**
   * @param form - The form of the ops: database names and encoded values, or code names and plain values.
   * @param strict - `false` reports a direct write as a modified path instead of throwing (for `$isModified`).
   */
  constructor(
    readonly form: OpsForm,
    readonly strict: boolean,
  ) {}

  /**
   * The path of this form.
   *
   * @param at - The code and database paths of one position.
   * @returns The database path for the `db` form, otherwise the code path.
   */
  pathOf(at: PathPair): string {
    return this.form === "db" ? at.db : at.code;
  }

  /**
   * A value of `node` in this form (encoded for the driver, or plain data in code names).
   *
   * @param node - The field node.
   * @param value - The value.
   * @returns The value in this form.
   */
  value(node: PathNode, value: unknown): unknown {
    /* Plain data first: only schema fields, no own `undefined` (a JS `sub.x = undefined` is an absent field). */
    if (TrackedProtocol.is(value)) TrackedProtocol.unknownIn(value, "", this.#pending);
    const plain = TrackedProtocol.toPlain(value, { maps: "map" });
    return this.form === "db" ? SchemaWalker.encodeValue(node, plain) : plain;
  }

  /**
   * Records that a stored value is REPLACED at `at` (an element, a Map entry, a field): its unknown fields are
   * lost.
   *
   * @param previous - The value being replaced.
   * @param at - Where it is replaced.
   */
  replaced(previous: unknown, at: PathPair): void {
    TrackedProtocol.unknownIn(previous, at.code, this.#unknown);
  }

  /**
   * Records one operation.
   *
   * @param operator - The update operator.
   * @param at - The position the operation writes to.
   * @param argument - The operator's argument.
   * @param version - The operation's version impact.
   */
  add(operator: UpdatePartOperator, at: PathPair, argument: unknown, version: VersionImpact): void {
    for (const found of this.#pending) {
      this.#unknown.push({ ...found, path: found.path === "" ? at.code : `${at.code}.${found.path}` });
    }
    this.#pending = [];
    const record = this.#parts[operator] ?? {};
    this.#parts[operator] = record;
    record[this.pathOf(at)] = argument;
    this.#modified.push(at.code);
    this.bump(version);
  }

  /**
   * Records a modified path without an op (lenient walks).
   *
   * @param at - The touched position.
   */
  touched(at: PathPair): void {
    this.#modified.push(at.code);
  }

  /**
   * Raises the version impact when `version` is stronger than the current one.
   *
   * @param version - The impact to merge in.
   */
  bump(version: VersionImpact): void {
    if (RANK[version] > RANK[this.#version]) this.#version = version;
  }

  /**
   * The collected result.
   *
   * @returns The ops, version impact, modified paths and unknown fields.
   */
  result(): CollectionDelta {
    return {
      ops: this.#parts as UpdateParts,
      version: this.#version,
      modifiedPaths: this.#modified,
      unknown: this.#unknown,
    };
  }
}

/** Helpers over {@link UpdateParts}. */
export class UpdateOps {
  /**
   * Merges the parts of several fields into one update. Two parts touching the same path, or a path
   * and its prefix, would be `ConflictingUpdateOperators` (code 40) on the server; tracked values never
   * produce that for different fields, so it is an internal error, never silently merged.
   *
   * @param parts - The parts of the fields.
   * @returns The merged update.
   * @throws {TypemoError} When two parts touch the same path or a path and its prefix.
   */
  static merge(parts: readonly UpdateParts[]): UpdateParts {
    const out: MutableParts = {};
    const paths: string[] = [];
    for (const part of parts) {
      for (const [operator, record] of Object.entries(part) as [UpdatePartOperator, Record<string, unknown>][]) {
        const target = out[operator] ?? {};
        out[operator] = target;
        for (const [path, argument] of Object.entries(record)) {
          const clash = paths.find((other) => UpdateOps.overlaps(other, path));
          if (clash !== undefined) {
            throw new TypemoError(`Internal error: the update touches "${clash}" and "${path}" together`);
          }
          paths.push(path);
          target[path] = argument;
        }
      }
    }
    return out as UpdateParts;
  }

  /**
   * Whether the parts contain no op.
   *
   * @param parts - The update parts.
   * @returns `true` when there is nothing to send.
   */
  static isEmpty(parts: UpdateParts): boolean {
    return Object.values(parts).every((record) => record === undefined || Object.keys(record).length === 0);
  }

  /**
   * Whether `a` and `b` are the same path or one is a prefix of the other.
   *
   * @param a - The first path.
   * @param b - The second path.
   * @returns `true` when they overlap.
   */
  static overlaps(a: string, b: string): boolean {
    return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  }
}
