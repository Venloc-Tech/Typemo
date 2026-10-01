/*
 * The same kind of entities with the standard (TC39) decorators of `@venloc/typemo-decorators`; the core comes from
 * `@venloc/typemo`. Compiled by `tsconfig.tc39.json`: no `experimentalDecorators`.
 */
import { Entity, EntityWithId, type HookThis, type Ref, Types } from "@venloc/typemo";
import { Index, Pre, Prop, Schema } from "@venloc/typemo-decorators";

/** A nested address. */
@Schema({ nested: true })
export class Address {
  @Prop(() => String, { required: true, trim: true })
  city!: string;
}

/** A code with its own string id (`EntityWithId` works with the TC39 decorators too). */
@Schema({ collection: "dc39_codes" })
export class Code extends EntityWithId(() => String) {
  @Prop(() => String, { required: true })
  label!: string;
}

/** A team: the target of `Member.team`. */
@Schema({ collection: "dc39_teams" })
export class Team extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

/** A member with a unique index, a nested address, a tag array, a reference and a hook. */
@Schema({ collection: "dc39_members" })
@Index({ name: 1 }, { unique: true })
export class Member extends Entity {
  @Prop(() => String, { required: true, trim: true })
  name!: string;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Address)
  address?: Address;

  @Prop(() => Types.ObjectId, { ref: () => Team })
  team?: Ref<Team>;

  @Pre("document.save")
  touch(this: HookThis<"document.save", Member>): void {
    /* The hook may also run on a subdocument of the class: `$isRoot()` narrows `this` to the hydrated document. */
    if (this.$isRoot()) this.tags.push("saved");
  }
}
