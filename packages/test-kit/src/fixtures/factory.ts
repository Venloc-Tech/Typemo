/**
 * A typed document factory produced by `defineFactory`.
 *
 * @example
 * ```ts
 * const users: Factory<{ name: string }> = defineFactory((n) => ({ name: `user-${n}` }));
 * users.build(); // { name: "user-1" }
 * ```
 */
export interface Factory<Entity> {
  /**
   * Builds one entity.
   *
   * @param overrides - Fields that replace the generated defaults.
   * @returns A new entity.
   */
  build(overrides?: Partial<Entity>): Entity;
  /**
   * Builds several entities, each with its own sequence number.
   *
   * @param count - How many entities to build.
   * @param overrides - Fields that replace the generated defaults of every entity.
   * @returns The new entities.
   */
  buildMany(count: number, overrides?: Partial<Entity>): Entity[];
}

/**
 * Typed document factory. `defaults` is called once per `build()` with a 1-based sequence number, so fixtures
 * can produce distinct values (e.g. unique emails) without the caller repeating that logic everywhere.
 *
 * A plain function rather than a static class: it is the only entry point of this module.
 *
 * @param defaults - Produces the default entity for a given sequence number.
 * @returns A factory that builds entities from those defaults.
 *
 * @example
 * ```ts
 * const users = defineFactory((n) => ({ email: `u${n}@example.test` }));
 * users.buildMany(2); // two entities with distinct emails
 * ```
 */
export const defineFactory = <Entity>(defaults: (sequence: number) => Entity): Factory<Entity> => {
  let sequence = 0;
  const build = (overrides: Partial<Entity> = {}): Entity => {
    sequence += 1;
    return { ...defaults(sequence), ...overrides };
  };
  const buildMany = (count: number, overrides: Partial<Entity> = {}): Entity[] =>
    Array.from({ length: count }, () => build(overrides));
  return { build, buildMany };
};
