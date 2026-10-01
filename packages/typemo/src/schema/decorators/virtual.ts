import { ConfigurationError } from "../../errors/configuration-error.ts";
import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import type { ClassRef } from "../metadata/metadata-types.ts";
import type { VirtualOptions } from "../options/virtual-options.ts";
import type { VirtualCheck } from "./class-checks.ts";
import { DecoratorGuard } from "./decorator-guard.ts";

/**
 * A populate virtual on a field declared `VirtualRef<Model, JustOne, Count>`. The model, `justOne`,
 * `count` and the paths are checked against the field type and both classes. Ordinary virtuals are
 * class getters and need no decorator.
 *
 * @param options - The referenced model and the local and foreign paths.
 * @returns A property decorator that records the virtual in the class metadata.
 * @throws {ConfigurationError} When applied to a static member, or when mixed with TC39 decorators.
 * @example
 * ```ts
 * @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
 * posts!: VirtualRef<Post>;
 * ```
 */
export const Virtual =
  <const O extends VirtualOptions>(options: O) =>
  <T extends object, K extends string>(target: T & VirtualCheck<T, K, O>, key: K): void => {
    DecoratorGuard.assertLegacy("@Virtual", key);
    const owner: object = target;
    if (typeof owner === "function") {
      throw new ConfigurationError(`${(owner as ClassRef).name}: @Virtual on static member "${key}"`);
    }
    MetadataBuilder.for((owner as { constructor: ClassRef }).constructor).addVirtual(key, options);
  };
