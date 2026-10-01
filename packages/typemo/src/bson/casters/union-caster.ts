import { ConfigurationError } from "../../errors/configuration-error.ts";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";
import type { CastOutput, ValueCaster } from "./value-caster.ts";

/**
 * A validator of a union member: `true` passes, a string is the failure message.
 *
 * @typeParam T - The hydrated type of the member.
 * @example
 * ```ts
 * const positive: UnionValidator<number> = (value) => (value > 0 ? true : "must be positive");
 * ```
 */
export type UnionValidator<T> = (value: T) => true | string;

/**
 * One failed validator of the selected member; the validation layer turns these into a `ValidationError`.
 *
 * @example
 * ```ts
 * const issue: ValidationIssue = { path: "shape", member: "circle", message: "must be positive", value: -1 };
 * ```
 */
export interface ValidationIssue {
  /** Dotted path of the validated value. */
  readonly path: string;
  /** Name of the union member the value belongs to. */
  readonly member: string;
  /** The message returned by the failed validator. */
  readonly message: string;
  /** The value that failed. */
  readonly value: unknown;
}

/**
 * A member of a union: how to recognize it (`accepts`), how to cast it and its validators.
 * Built with `UnionCaster.member`. Methods on purpose (parameter bivariance lets members of
 * different types share one list).
 *
 * @typeParam T - The hydrated type of the member.
 * @example
 * ```ts
 * const member: UnionMember<string> = UnionCaster.member("text", (v) => typeof v === "string", StringCaster);
 * member.accepts("a"); // true
 * ```
 */
export interface UnionMember<T> {
  /** The member name, unique inside the union. */
  readonly name: string;
  /** The caster applied to values this member claims. */
  readonly caster: ValueCaster<T>;
  /**
   * Does this member claim the value? Must not throw.
   *
   * @param value - The raw user input.
   * @returns `true` when this member claims the value.
   */
  accepts(value: unknown): boolean;
  /**
   * Messages of the validators that fail for a value of this member.
   *
   * @param value - The hydrated value.
   * @returns The failure messages (empty when all validators pass).
   */
  validate(value: T): readonly string[];
}

/**
 * A union caster: a `ValueCaster` that also tells which member a value belongs to and runs its validators.
 *
 * @typeParam T - The union of the hydrated member types.
 * @example
 * ```ts
 * const caster: UnionValueCaster<string | Date> = UnionCaster.byGuard(textMember, dateMember);
 * caster.select("a"); // "text"
 * ```
 */
export interface UnionValueCaster<T> extends ValueCaster<T> {
  /** Member names in declaration order. */
  readonly members: readonly string[];
  /**
   * The one member that claims the value; `CastError` (`union-no-match` / `union-ambiguous`) otherwise.
   *
   * @param value - The raw user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The name of the member that claims the value.
   * @throws {CastError} When no member or several members claim the value.
   */
  select(value: unknown, path?: string): string;
  /**
   * Runs the validators of the member the (hydrated) value belongs to — only that member's.
   *
   * @param value - The hydrated value.
   * @param path - Dotted path of the value, copied into every issue.
   * @returns The failed validators (empty when all pass).
   * @throws {CastError} When no member or several members claim the value.
   */
  validate(value: T, path?: string): readonly ValidationIssue[];
}

/**
 * The hydrated type of a union member.
 *
 * @typeParam M - The member type to read the value type of.
 * @example
 * ```ts
 * type Text = MemberType<UnionMember<string>>; // string
 * type Bad = MemberType<number>; // never
 * ```
 */
type MemberType<M> = M extends UnionMember<infer T> ? T : never;

/**
 * Validators of the members of a discriminated union, by member name.
 *
 * @typeParam M - The member casters by name.
 * @example
 * ```ts
 * type V = DiscriminatedValidators<{ circle: ValueCaster<{ r: number }> }>;
 * // { readonly circle?: readonly UnionValidator<{ r: number }>[] }
 * ```
 */
export type DiscriminatedValidators<M extends Readonly<Record<string, ValueCaster<object>>>> = {
  readonly [K in keyof M]?: readonly UnionValidator<CastOutput<M[K]>>[];
};

/**
 * Union of types: a member is chosen by a discriminator or a type guard,
 * never by "try the casters in order". Exactly one member must claim the value:
 * - none → `CastError` `union-no-match` (Mongoose reported the last member's error);
 * - several → `CastError` `union-ambiguous` (Mongoose silently took the first: `[Number, Date]` +
 *   `'2020'` gave a number);
 * - one → that member's caster casts the value; its validators run in `validate`, and only its own
 *   (Mongoose ran none of the member validators, gh-15732).
 *
 * Validation is a separate call on purpose: casting happens on assignment, validation later
 * (after `pre('save')`).
 */
export class UnionCaster {
  /**
   * A member recognized by a type guard on the raw value.
   *
   * @typeParam T - The hydrated type of the member.
   * @param name - The member name, unique inside the union.
   * @param guard - Tells whether the raw value belongs to this member; must not throw.
   * @param caster - The caster applied to values of this member.
   * @param validators - Validators run on the hydrated value.
   * @returns The union member.
   */
  static member<T>(
    name: string,
    guard: (value: unknown) => boolean,
    caster: ValueCaster<T>,
    validators: readonly UnionValidator<T>[] = [],
  ): UnionMember<T> {
    return {
      name,
      caster,
      accepts: (value: unknown): boolean => guard(value),
      validate: (value: T): readonly string[] =>
        validators.map((validator) => validator(value)).filter((result): result is string => result !== true),
    };
  }

  /**
   * A union whose member is chosen by type guards (`typeof v === "string"`, `BsonGuards.isDate`, …).
   *
   * @typeParam M - The tuple of members.
   * @param members - The members, each with its own guard.
   * @returns A union caster of the members' types.
   * @throws {ConfigurationError} When there are no members or two share a name.
   */
  static byGuard<const M extends readonly UnionMember<unknown>[]>(
    ...members: M
  ): UnionValueCaster<MemberType<M[number]>> {
    return UnionCaster.build<MemberType<M[number]>>(
      members as readonly UnionMember<MemberType<M[number]>>[],
      undefined,
    );
  }

  /**
   * A union of subdocuments chosen by the string value of a discriminator field (`kind: "circle"`).
   * Each member caster must declare the discriminator field itself (a `SubdocumentCaster` refuses
   * unknown fields).
   *
   * @typeParam M - The member casters by name.
   * @param key - The discriminator field name.
   * @param members - The member casters, keyed by the discriminator value that selects them.
   * @param validators - Validators of each member, by member name.
   * @returns A union caster of the members' types.
   * @throws {ConfigurationError} When there are no members.
   */
  static byDiscriminator<const M extends Readonly<Record<string, ValueCaster<object>>>>(
    key: string,
    members: M,
    validators: DiscriminatedValidators<M> = {},
  ): UnionValueCaster<CastOutput<M[keyof M]>> {
    type Out = CastOutput<M[keyof M]>;
    const list = Object.entries(members).map(([name, caster]) =>
      UnionCaster.member<Out>(
        name,
        (value) => BsonGuards.isPlainObject(value) && value[key] === name,
        caster as ValueCaster<Out>,
        (validators[name] ?? []) as readonly UnionValidator<Out>[],
      ),
    );
    return UnionCaster.build<Out>(list, key);
  }

  /**
   * Builds the union caster from ready members.
   *
   * @typeParam T - The union of the hydrated member types.
   * @param members - The members of the union.
   * @param discriminator - The discriminator field name, used only in error details.
   * @returns The union caster.
   * @throws {ConfigurationError} When there are no members or two share a name.
   */
  private static build<T>(members: readonly UnionMember<T>[], discriminator: string | undefined): UnionValueCaster<T> {
    if (members.length === 0) throw new ConfigurationError("UnionCaster: a union needs at least one member");
    const names = members.map((member) => member.name);
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate !== undefined) throw new ConfigurationError(`UnionCaster: duplicate member "${duplicate}"`);
    const expected = members.map((member) => member.caster.expected).join(" | ");

    /* The single member that claims the value; `undefined`/`null` go to the shared reject reasons. */
    const pick = (value: unknown, path: string): UnionMember<T> => {
      const claimed = members.filter((member) => member.accepts(value));
      const [first] = claimed;
      if (first !== undefined && claimed.length === 1) return first;
      if (claimed.length > 1) {
        return CastSupport.fail(
          path,
          value,
          expected,
          "union-ambiguous",
          `members ${claimed.map((member) => `"${member.name}"`).join(", ")} all accept this value`,
        );
      }
      if (value === undefined || value === null) return CastSupport.reject(path, value, expected, "");
      const detail =
        discriminator === undefined
          ? `no member accepts this value (members: ${names.join(", ")})`
          : `the discriminator "${discriminator}" must be one of ${names.map((name) => `"${name}"`).join(", ")}`;
      return CastSupport.fail(path, value, expected, "union-no-match", detail);
    };

    return {
      expected,
      members: names,
      cast: (value: unknown, path = ""): T => pick(value, path).caster.cast(value, path),
      encode: (value: T): unknown => pick(value, "").caster.encode(value),
      select: (value: unknown, path = ""): string => pick(value, path).name,
      validate: (value: T, path = ""): readonly ValidationIssue[] => {
        const member = pick(value, path);
        return member.validate(value).map((message) => ({ path, member: member.name, message, value }));
      },
    };
  }
}
