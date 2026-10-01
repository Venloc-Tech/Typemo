/*
 * The TC39 model of the package tests. `legacy-twin.ts` declares the same classes with the core's legacy
 * decorators (run in the core package, where experimentalDecorators is on); keep the two bodies identical.
 */
import { Entity } from "@venloc/typemo";
import { Index, Pre, Prop, Schema } from "../../src/index.ts";

/** A nested address. */
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true, trim: true }) city!: string;
  @Prop(() => String) zip?: string;
}

/** A user with a unique compound index and a pre-save hook. */
@Schema({ collection: "tc39_pkg_users" })
@Index({ name: 1, age: -1 }, { unique: true })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true }) name!: string;
  @Prop(() => Number, { min: 0 }) age?: number;
  @Prop(() => [String]) tags?: string[];
  @Prop(() => Address) address?: Address;
  @Prop(() => String, { sensitive: "hide" }) secret?: string;

  /** Appends a `saved` tag before every save. */
  @Pre("document.save")
  touch(this: User): void {
    this.tags = [...(this.tags ?? []), "saved"];
  }
}

export { Address, User };
