/*
 * Run in its own process by test/unit/schema/plugins.test.ts: the global plugin registry is
 * process-wide and seals at the first successful compile, so it cannot be exercised inside the shared test run.
 */
import {
  Entity,
  PluginRegistry,
  Prop,
  Schema,
  SchemaCompiler,
  type SchemaPlugin,
  Typemo,
} from "../../../src/internal.ts";

const order: string[] = [];
/**
 * A plugin that records `<name>:<target>` for every schema it is applied to.
 *
 * @param name - the plugin name
 * @returns the plugin
 */
const tracer = (name: string): SchemaPlugin =>
  ({ name, apply: (builder) => void order.push(`${name}:${builder.target.name}`) }) satisfies SchemaPlugin;

/** A schema whose compile FAILS (an unregistered extension key): it must leave both registries open. */
@Schema()
class Broken extends Entity {
  @Prop(() => String, { ext: { notRegistered: {} } as never }) name?: string;
}
const beforeFailure = new PluginRegistry("connection");
let failedCompile = "";
try {
  SchemaCompiler.compile(Broken, { plugins: beforeFailure });
} catch (error) {
  failedCompile = (error as Error).message;
}
/* Both succeed: the failed compile sealed neither the connection registry nor the global one below. */
beforeFailure.use(tracer("after-failed"));
const afterFailed = beforeFailure.list.length;

const globalOne = tracer("global-one");
Typemo.plugin(globalOne);
Typemo.plugin(tracer("global-two"));
/* the same plugin twice: applied once */
Typemo.plugin(globalOne);

const connection = new PluginRegistry("connection").use(tracer("connection"));

/** The schema every plugin is applied to. */
@Schema()
class Account extends Entity {
  @Prop(() => String) name?: string;
}

SchemaCompiler.compile(Account, { plugins: connection });

let late = "";
try {
  Typemo.plugin(tracer("late"));
} catch (error) {
  late = (error as Error).message;
}
let lateConnection = "";
try {
  connection.use(tracer("late-connection"));
} catch (error) {
  lateConnection = (error as Error).message;
}

console.log(JSON.stringify({ order, late, lateConnection, failedCompile, afterFailed }));
