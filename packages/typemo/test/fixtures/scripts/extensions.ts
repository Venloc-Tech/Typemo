/*
 * Run in its own process by test/unit/schema/extensions.test.ts: the GLOBAL extension registry (`Typemo.use`) is
 * process-wide and is sealed by the first successful compile, so its semantics cannot be exercised inside the shared
 * test run. Everything per client runs in process (test/unit/schema/extensions.test.ts, extensions-events.test.ts).
 */
import { testLabelExtension } from "../../../../test-kit/fixtures/extensions/test-label-extension.ts";
import {
  ClientInternals,
  ConfigurationError,
  Entity,
  Prop,
  Schema,
  SchemaCompiler,
  Typemo,
  TypemoClient,
} from "../../../src/internal.ts";
import { Labeled } from "../extensions/labeled-entities.ts";

/**
 * The message of the `ConfigurationError` a call must throw.
 *
 * @param run - the call that must fail
 * @returns the error message
 * @throws the original error when it is not a `ConfigurationError`, or an `Error` when the call succeeded
 */
const errorOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    return error.message;
  }
  throw new Error("expected a ConfigurationError");
};

/** An entity a "library" compiles on import — after the global registration, which it then fixes. */
@Schema({ collection: "x_library" })
class LibraryThing extends Entity {
  @Prop(() => String) name?: string;
}

/** An entity whose compile FAILS (an unregistered extension key): it must leave every registry open. */
@Schema({ collection: "x_broken" })
class BrokenThing extends Entity {
  @Prop(() => String, { ext: { notRegisteredYet: {} } as never }) name?: string;
}

/* A client that exists before the global registration. */
const early = new TypemoClient("mongodb://127.0.0.1:1", { dbName: "x" });
const library = new TypemoClient("mongodb://127.0.0.1:1", { dbName: "lib" });

/* A failed compile (on a client and without one) fixes nothing. */
const failedCompile = errorOf(() => library.connection.model(BrokenThing));
errorOf(() => SchemaCompiler.compile(BrokenThing));
Typemo.use(testLabelExtension);
library.use({ name: "libEarly", validateProp: () => undefined } as never);
const duplicate = errorOf(() => Typemo.use({ ...testLabelExtension }));
const duplicateOnClient = errorOf(() => early.use({ ...testLabelExtension }));
const noValidators = errorOf(() => Typemo.use({ name: "empty" } as never));
const earlySeesGlobal = early.connection.model(Labeled).schema.extOf("email");
/* The first successful compile anywhere fixes the global list, like Typemo.plugin. */
const lateGlobal = errorOf(() => Typemo.use({ name: "late", validateProp: () => undefined } as never));
library.connection.model(LibraryThing);
const lateOnLibrary = errorOf(() => library.use({ name: "libLate", validateProp: () => undefined } as never));
/* A client whose own first model is not compiled yet still registers its own extensions. */
const fresh = new TypemoClient("mongodb://127.0.0.1:1", { dbName: "y" });
fresh.use({ name: "ownAfterGlobalSealed", validateProp: () => undefined } as never);

console.log(
  JSON.stringify({
    failedCompile,
    duplicate,
    duplicateOnClient,
    noValidators,
    earlySeesGlobal,
    lateOnLibrary,
    lateGlobal,
    freshNames: ClientInternals.extensions(fresh).names,
  }),
);
await Promise.all([early.close(), library.close(), fresh.close()]);
