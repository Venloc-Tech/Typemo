// biome-ignore-all lint/suspicious/noExplicitAny: this fixture leaks `any` on purpose for the guard to find.
/*
 * Fixture for no-any-in-public-api.test.ts: a public API that leaks `any` in every way the
 * guard must catch, next to places where `any` is legitimately invisible from outside.
 * Not part of any tsconfig; only the guard compiles it.
 */

/**
 * Inferred `any`: no `any` keyword in the source, the return type is `any`.
 *
 * @param text - JSON text.
 * @returns The parsed value.
 */
export const parse = (text: string) => JSON.parse(text);

/**
 * An options bag with `any` in several positions.
 *
 * @example
 * ```ts
 * const options: Options = { loose: 1, nested: { deep: [] }, clean: "x" };
 * ```
 */
export interface Options {
  /** Explicit `any`. */
  loose: any;
  /** `any` as a type argument of a library type. */
  nested: { deep: Array<any> };
  /** A clean member. */
  readonly clean: string;
}

/**
 * A callback that accepts `any`.
 *
 * @example
 * ```ts
 * const handler: Handler = (value) => void value;
 * ```
 */
export type Handler = (value: any) => void;

/** `any` only inside a conditional-type branch of a non-exported helper. */
type Hidden<T> = T extends string ? any : never;

/**
 * Exposes the hidden helper.
 *
 * @example
 * ```ts
 * type Result = Exposed<string>;
 * ```
 */
export type Exposed<T> = Hidden<T>;

/** A class with private and public `any` members. */
export class Service {
  /* Private members are not API (a `.d.ts` prints them without a type). */
  private secret: any = 1;
  /** Public data with `any` values. */
  data: Record<string, any> = {};
  /**
   * Runs the service.
   *
   * @returns A number.
   */
  run(): number {
    return this.secret;
  }
}

/** A promise of `any`. */
export const wrapped: Promise<any> = Promise.resolve(1);

/**
 * Clean API: `any` only inside the implementation body.
 *
 * @returns A number.
 */
export const internalAny = (): number => {
  const value: any = 1;
  return value;
};

/**
 * A clean function.
 *
 * @param value - A number.
 * @returns Its text.
 */
export const clean = (value: number): string => String(value);
