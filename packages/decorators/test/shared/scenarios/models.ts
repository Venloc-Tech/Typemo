/*
 * The models of the shared suite, written ONCE. The decorators come from the alias
 * `@typemo-shared/decorators`, which each runner's tsconfig points at its own package (legacy core or TC39).
 * Every field names its type explicitly (`@Prop(() => T)`): TC39 has no emitDecoratorMetadata.
 */
import "../../../../test-kit/fixtures/extensions/test-label-extension.ts";
import { Discriminator, Index, Plugin, Post, PostError, Pre, Prop, Schema, Virtual } from "@typemo-shared/decorators";
import {
  type Defaulted,
  type DiscriminatorValue,
  Entity,
  Mask,
  type Ref,
  type SchemaPlugin,
  Spec,
  Types,
  Versioned,
  type VirtualRef,
} from "@venloc/typemo";

/** The arguments the transpiler passed to a class decorator (tells the runner which mode ran). */
export const probe: { args: readonly unknown[] } = { args: [] };

/**
 * A class decorator that records its own arguments in `probe`.
 *
 * @param args - Whatever the transpiler passed.
 */
const recordProbe = (...args: unknown[]): void => {
  probe.args = args;
};

/** What hooks and plugins saw, in order. */
export const trace: string[] = [];

/** A plugin that adds a pre-save hook, to prove plugin hooks run after the class hooks. */
const sharedPlugin: SchemaPlugin = {
  name: "sharedTrace",
  apply: (builder) => {
    builder.addHook("pre", ["document.save"], () => {
      trace.push("plugin pre save");
    });
  },
};

/** A nested address. */
@Schema({ nested: true })
export class SharedAddress {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) zip?: string;
}

/** An embedded pet, used as an array of subdocuments. */
@Schema()
export class SharedPet {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
}

/** An author with a virtual populate of its posts; also records the decorator mode. */
@recordProbe
@Schema({ collection: "shared_authors" })
export class SharedAuthor extends Entity {
  @Prop(() => String, { required: true }) name!: string;

  @Virtual({ ref: () => SharedPost, localField: "_id", foreignField: "author" })
  posts?: VirtualRef<SharedPost>;
}

/** A post with a ref to its author and a compound index. */
@Schema({ collection: "shared_posts" })
@Index({ title: 1, views: -1 })
export class SharedPost extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { default: 0 }) views!: Defaulted<number>;
  @Prop(() => Types.ObjectId, { ref: () => SharedAuthor, required: true }) author!: Ref<SharedAuthor>;
}

/** The widest model: every field kind, hooks, a plugin, an index, sensitive fields and an extension. */
@Schema({ collection: "shared_people", ext: { testLabel: { group: "people" } } })
@Plugin(sharedPlugin)
@Index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $exists: true } } })
export class SharedPerson extends Entity {
  @Prop(() => String, { required: true, ext: { testLabel: { label: "Name" } } }) name!: string;
  @Prop(() => String, { sensitive: Mask.email() }) email?: string;
  @Prop(() => String, { sensitive: "hide" }) secret?: string;
  @Prop(() => [String]) tags?: string[];
  @Prop(() => [Number]) scores?: number[];
  @Prop(() => SharedAddress) address?: SharedAddress;
  @Prop(() => [SharedPet]) pets?: SharedPet[];
  @Prop(() => Spec.map(Number)) counters?: Map<string, number>;
  @Prop(() => Date, { nullable: true }) seenAt?: Date | null;

  /** Records a pre-save hook run. */
  @Pre("document.save") preSave(this: SharedPerson): void {
    trace.push(`pre save ${this.name}`);
  }
  /** Records a post-save hook run. */
  @Post("document.save") postSave(this: SharedPerson): void {
    trace.push(`post save ${this.name}`);
  }
  /** Records a failed save. */
  @PostError("document.save") errorSave(this: SharedPerson): void {
    trace.push(`error save ${this.name}`);
  }
}

/** A discriminator child of `SharedPerson`. */
@Discriminator("admin")
export class SharedAdmin extends SharedPerson {
  declare readonly __t: DiscriminatorValue<"admin">;
  @Prop(() => Number, { required: true }) level!: number;
}

/** A versioned model with optimistic concurrency. */
@Schema({ collection: "shared_ledgers", optimisticConcurrency: true })
export class SharedLedger extends Versioned(Entity) {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
