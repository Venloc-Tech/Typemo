/*
 * Entities written as a user writes them: legacy decorators, imports from the package names only. Compiled by the
 * plain consumer tsconfig (no `.ts` imports, no `emitDecoratorMetadata`, default `useDefineForClassFields`).
 */
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  EntityWithId,
  Index,
  type OperationHookContext,
  Pre,
  Prop,
  type Ref,
  Schema,
  Tenant,
  type TenantField,
  Timestamped,
  Types,
} from "@venloc/typemo";

/** A region: the target of `User.region`. */
@Schema({ collection: "dc_regions" })
export class Region extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

/** A user with timestamps, a reference, a tag array, a nested address, a virtual and an index. */
@Schema({ collection: "dc_users" })
@Index({ email: 1 }, { unique: true })
export class User extends Timestamped(Entity) {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true, lowercase: true })
  email!: string;

  @Prop(() => Number, { min: 0 })
  age?: number;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Types.ObjectId, { ref: () => Region })
  region?: Ref<Region>;

  label(): string {
    return `${this.name} <${this.email}>`;
  }
}

/** An order for the aggregation rows. */
@Schema({ collection: "dc_orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  status!: string;

  @Prop(() => Number, { required: true })
  amount!: number;
}

/** A country with its ISO code as the id. */
@Schema({ collection: "dc_countries" })
export class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true })
  name!: string;
}

/** A tenant-scoped note with a pre hook. */
@Schema({ collection: "dc_notes", tenant: true })
export class Note extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true })
  text!: string;

  @Pre("query.find")
  audit(this: OperationHookContext<Note>): void {
    void this.filter;
  }
}

/** The base of a discriminator family. */
@Schema({ collection: "dc_shapes" })
export class Shape extends Entity {
  @Prop(() => String)
  label?: string;
}

/** A circle. */
@Discriminator("circle")
export class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;

  @Prop(() => Number, { required: true })
  radius!: number;
}
