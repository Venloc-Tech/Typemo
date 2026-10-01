/*
 * Run in its own process by test/ported/mechanisms/plugins.test.ts: ported from mongoose test/index.test.js:340
 * "declaring global plugins (gh-5690)" — a global plugin is applied to the schema AND to the schema of its
 * subdocuments; its pre('save') runs for both. (Mongoose's `s.methods.testMethod` has no counterpart: a
 * document is an instance of its class — a method is a method of the class.)
 */
import { Entity, Plugin, Prop, Schema, type SchemaPlugin, Typemo, TypemoClient } from "../../../src/index.ts";

const calls: string[] = [];
let preSaveCalls = 0;
const global: SchemaPlugin = {
  name: "global",
  apply: (builder) => {
    calls.push(builder.target.name);
    builder.addHook("pre", "document.save", () => {
      ++preSaveCalls;
    });
  },
};
Typemo.plugin(global);

let called = 0;
const own: SchemaPlugin = { name: "own", apply: () => void ++called };

/** A subdocument: the global plugin applies to its schema as well. */
@Schema()
class Sub {
  @Prop(() => String) name?: string;
}

/** A root with its own plugin and an array of subdocuments. */
@Plugin(own)
@Schema({ collection: "pm_global_plugins" })
class GlobalPlugins extends Entity {
  @Prop(() => [Sub]) test?: Sub[];
}

const client = new TypemoClient(process.env.TYPEMO_TEST_URI as string, {
  dbName: process.env.TYPEMO_TEST_DB as string,
});
await client.connect();
try {
  const M = client.connection.model(GlobalPlugins);
  const before = preSaveCalls;
  await M.create({ test: [{ name: "Val" }] });
  console.log(JSON.stringify({ called, calls, before, preSaveCalls }));
} finally {
  await client.close();
}
