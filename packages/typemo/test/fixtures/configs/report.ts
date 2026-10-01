/*
 * Run by test/runtime/schema/decorator-configs.test.ts once per user configuration (cwd = a folder of
 * ./configs): the schema layer must behave the same with emitDecoratorMetadata on or off and with
 * useDefineForClassFields true or false. Prints a JSON report to stdout.
 */
import { ObjectId } from "mongodb";
import {
  type Defaulted,
  Entity,
  HydrationSupport,
  Prop,
  type Ref,
  Schema,
  SchemaCompiler,
  Spec,
  Timestamped,
} from "../../../src/internal.ts";

/** A nested (dotted-path) name object. */
@Schema({ nested: true })
class Name {
  @Prop(() => String, { required: true }) first!: string;
  @Prop(() => String) last?: string;
}

/** A subdocument used in an array. */
@Schema()
class Tag {
  @Prop(() => String) label!: string;
}

/** An entity with every kind of field the report inspects, a self reference and a getter. */
@Schema()
class Member extends Timestamped(Entity) {
  @Prop(() => Name) name!: Name;
  @Prop(() => Number, { default: 1 }) level!: Defaulted<number>;
  @Prop(() => String, { nullable: true }) note!: string | null;
  @Prop(() => [Tag]) tags?: Tag[];
  @Prop(() => Spec.map(Number)) scores?: Map<string, number>;
  @Prop(() => ObjectId, { ref: () => Member }) friend?: Ref<Member>;
  get initials(): string {
    return this.name.first.slice(0, 1);
  }
}

/** An entity whose field has an initializer: compiling it must fail. */
@Schema()
class WithInitializer extends Entity {
  @Prop(() => Number) score: number = 5;
}

const schema = SchemaCompiler.compile(Member);
const raw = new Member();
const hydrated = HydrationSupport.instantiate<Member>(schema);
let initializer = "";
try {
  SchemaCompiler.compile(WithInitializer);
} catch (error) {
  initializer = (error as Error).message;
}
/* cast: the GLOBAL Reflect must not be patched, so `getMetadata` is not in its type */
const metadataApi = typeof (Reflect as unknown as { getMetadata?: unknown }).getMetadata;

console.log(
  JSON.stringify({
    describe: schema.describe(),
    ownKeysAfterNew: Object.keys(raw),
    ownKeysAfterHydration: Object.keys(hydrated),
    getterWorks: Object.assign(hydrated, { name: { first: "Zed" } }).initials,
    initializer,
    metadataApi,
  }),
);
