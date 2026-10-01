// Helpers of the package's tests: a database name per test, a Nest testing module on the shared replica set, and an
// application listening on a free port for the HTTP tests (Bun's `fetch`, no extra HTTP client).
import type { DynamicModule, INestApplication, Type } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { MongoHarness } from "@venloc/typemo-test-kit";

/** A connection string that no server answers (port 1), for the tests of failed connections. */
export const DEAD_URI = "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200&directConnection=true";

let counter = 0;

/** Helpers to start Nest modules and applications on the shared MongoDB. */
export class NestTest {
  /**
   * A database name of its own.
   *
   * @param prefix - The prefix.
   * @returns The name.
   */
  static db(prefix: string): string {
    counter += 1;
    return `nest_${prefix}_${Date.now()}_${counter}`;
  }

  /**
   * The URI of the shared replica set (started on first use).
   *
   * @returns The URI.
   */
  static async uri(): Promise<string> {
    await MongoHarness.ensureStarted();
    return MongoHarness.getUri();
  }

  /**
   * Compiles and initializes a testing module.
   *
   * @param imports - The modules.
   * @param providers - Extra providers.
   * @returns The initialized module (close it).
   */
  static async module(
    imports: readonly (Type<unknown> | DynamicModule)[],
    providers: readonly NonNullable<Parameters<typeof Test.createTestingModule>[0]["providers"]>[number][] = [],
  ): Promise<TestingModule> {
    const ref = await Test.createTestingModule({ imports: [...imports], providers: [...providers] }).compile();
    ref.useLogger(false);
    await ref.init();
    return ref;
  }

  /**
   * Starts an HTTP application on a free port.
   *
   * @param root - The root module.
   * @param setup - Called before `listen` (global filters, interceptors).
   * @returns The application and its base URL.
   */
  static async app(
    root: Type<unknown> | DynamicModule,
    setup: (app: INestApplication) => void = () => undefined,
  ): Promise<{ readonly app: INestApplication; readonly url: string }> {
    const ref = await Test.createTestingModule({ imports: [root] }).compile();
    const app = ref.createNestApplication({ logger: false });
    setup(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { readonly port: number };
    return { app, url: `http://127.0.0.1:${address.port}` };
  }
}
