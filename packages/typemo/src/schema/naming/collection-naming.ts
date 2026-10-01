import { ConfigurationError } from "../../errors/configuration-error.ts";

/**
 * Turns a class name into a collection name; pluggable, passed in the compile context.
 *
 * @example
 * ```ts
 * const snakeCase: NamingFunction = (className) => className.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
 * ```
 */
export type NamingFunction = (className: string) => string;

/**
 * Mongoose's legacy pluralizer (`lib/helpers/pluralize.js`), same rules in the same order, with its
 * bugs fixed (verified by running Mongoose's file, see the naming table test):
 * - `/(matr|vert|ind)ix|ex$/` was unanchored: `matrixcell` → `matricescell`, `indixa` → `indicesa`.
 *   Words ending in "ex"/"ix" never reached it (the rule for x/ch/ss/sh comes first: `complex` →
 *   `complexes`, `index` → `indexes`), so the rule is dropped: it could only ever fire wrongly;
 * - `/([m|l])ouse$/` had "|" inside the character class;
 * - `data` → `datas`, `criterion` → `criterions`, `phenomenon` → `phenomenons`: fixed;
 * - the rule tables were unreachable from outside (assigned after `module.exports`); here the rules
 *   are fixed and a different naming is a naming function, not a mutation of shared tables.
 * Everything else gives Mongoose's results, so existing collections keep their names.
 */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/human$/i, "humans"],
  [/(m|wom)an$/i, "$1en"],
  [/(pe)rson$/i, "$1ople"],
  [/(child)$/i, "$1ren"],
  [/^(ox)$/i, "$1en"],
  [/(ax|test)is$/i, "$1es"],
  [/(octop|cact|foc|fung|nucle)us$/i, "$1i"],
  [/(alias|status|virus)$/i, "$1es"],
  [/(bu)s$/i, "$1ses"],
  [/(buffal|tomat|potat)o$/i, "$1oes"],
  [/(criteri|phenomen)on$/i, "$1a"],
  [/([ti])um$/i, "$1a"],
  [/sis$/i, "ses"],
  [/(?:([^f])fe|([lr])f)$/i, "$1$2ves"],
  [/(hive)$/i, "$1s"],
  [/([^aeiouy]|qu)y$/i, "$1ies"],
  [/(x|ch|ss|sh)$/i, "$1es"],
  [/([ml])ouse$/i, "$1ice"],
  [/(kn|w|l)ife$/i, "$1ives"],
  [/(quiz)$/i, "$1zes"],
  [/^goose$/i, "geese"],
  [/s$/i, "s"],
  [/([^a-z])$/i, "$1"],
  [/$/, "s"],
];

/**
 * Words that do not change. Mongoose's list plus `data` / `metadata` (already plural). `status` is
 * kept uncountable as in Mongoose (it listed it both here and in a rule; the list won).
 */
const UNCOUNTABLE: ReadonlySet<string> = new Set([
  "advice",
  "energy",
  "excretion",
  "digestion",
  "cooperation",
  "health",
  "justice",
  "labour",
  "machinery",
  "equipment",
  "information",
  "pollution",
  "sewage",
  "paper",
  "money",
  "species",
  "series",
  "rain",
  "rice",
  "fish",
  "sheep",
  "moose",
  "deer",
  "news",
  "expertise",
  "status",
  "media",
  "data",
  "metadata",
]);

/**
 * Collection names: automatic like Mongoose (the class name lowercased and pluralized in English,
 * `User` → `users`, `UserProfile` → `userprofiles`), explicit with `@Schema({ collection })`, or
 * produced by a naming function of the compile context.
 */
export class CollectionNaming {
  /**
   * English plural of a lowercase word (Mongoose rules with the bugs fixed).
   *
   * @param word - A lowercase singular word.
   * @returns The plural, or the word itself when it is uncountable or no rule matches.
   */
  static pluralize(word: string): string {
    if (UNCOUNTABLE.has(word)) return word;
    const rule = RULES.find(([pattern]) => pattern.test(word));
    return rule === undefined ? word : word.replace(rule[0], rule[1]);
  }

  /**
   * The default naming: lowercase + plural, like Mongoose. An arrow field, because it is passed as a
   * callback and needs no bound `this`.
   */
  static readonly default: NamingFunction = (className) => CollectionNaming.pluralize(className.toLowerCase());

  /**
   * Validates a collection name.
   *
   * @param name - The candidate name.
   * @param where - The place named in the error text, for example a class name.
   * @returns `name` when it is valid.
   * @throws {ConfigurationError} When `name` is empty, not a string, contains `$` or a null character,
   * or starts with `system.`.
   */
  static check(name: unknown, where: string): string {
    if (typeof name !== "string" || name === "")
      throw new ConfigurationError(`${where}: the collection name must be a non-empty string`);
    if (name.includes("$") || name.includes("\0")) {
      throw new ConfigurationError(`${where}: the collection name "${name}" cannot contain "$" or a null character`);
    }
    if (name.startsWith("system.")) throw new ConfigurationError(`${where}: "system." collections are reserved`);
    return name;
  }
}
