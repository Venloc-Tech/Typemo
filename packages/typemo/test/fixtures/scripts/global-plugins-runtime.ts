/*
 * Run in its own process by test/runtime/mechanisms/plugins.test.ts: a GLOBAL plugin
 * with a hook, a static and a policy, applied to every schema compiled afterwards — on the real server
 * (the parent passes the URI and the database). The global registry is process-wide and seals at the first
 * compile, so it cannot be exercised inside the shared test run.
 */
import {
  Entity,
  type Model,
  type OperationHookContext,
  Pre,
  Prop,
  Schema,
  type SchemaPlugin,
  Typemo,
  TypemoClient,
} from "../../../src/index.ts";
import { ModelInternals } from "../../../src/internal.ts";

const order: string[] = [];

const stamped: SchemaPlugin<undefined, { countAll(this: Model<object>): Promise<number> }> = {
  name: "stamped",
  apply: (builder) => {
    builder.enablePolicy("softDelete", true);
    builder.addHook("pre", "query.find", function (this: unknown) {
      order.push(`global pre ${(this as OperationHookContext<object>).event}`);
    });
  },
  statics: {
    countAll(this: Model<object>): Promise<number> {
      return this.countDocuments().policy({ includeDeleted: true }).exec();
    },
  },
};

Typemo.plugin(stamped);

/** An entity with a soft-delete field and its own `query.find` hook, run after the plugin's. */
@Schema({ collection: "m9_global_items" })
class Item extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;

  @Pre("query.find") own(this: OperationHookContext<Item>): void {
    order.push(`class pre ${this.event}`);
  }
}

const uri = process.env.TYPEMO_TEST_URI as string;
const client = new TypemoClient(uri, { dbName: process.env.TYPEMO_TEST_DB as string });
await client.connect();
try {
  const Items = client.connection.model(Item);
  await Items.insertMany([{ name: "a" }, { name: "b" }]);
  /* soft delete: the policy the plugin enabled */
  await Items.deleteOne({ name: "a" });
  const live = await Items.find().lean();
  const all = await Items.statics(stamped).countAll();
  let late = "";
  try {
    Typemo.plugin({ name: "late", apply: () => undefined });
  } catch (error) {
    late = (error as Error).message;
  }
  console.log(
    JSON.stringify({
      order,
      live: live.map((item) => item.name),
      all,
      plugins: ModelInternals.schema(Items).plugins,
      late,
    }),
  );
} finally {
  await client.close();
}
