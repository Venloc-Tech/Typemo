import type { Db } from "mongodb";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { ErrorTranslator } from "../errors/error-translator.ts";
import type { OperationContext, OperationTarget } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";

/*
 * MongoDB creates a missing collection on the first write (and on the first index), always as a plain collection.
 * Some schema options can only be given when the collection is created — `capped`, `timeseries`, `clustered`,
 * `collation` (`collMod` cannot add them later; see `CollectionManager`). A write that would create such a
 * collection implicitly would silently lose them, and `ensureCollection` would fail later with "options MongoDB
 * cannot change". So the first write of a model with such options (an insert, a `bulkWrite`, an upsert) and the
 * index commands check that the collection exists; a missing one is a `ConfigurationError` that says to create it
 * with `connection.init()` or `ensureCollection()`. The check runs once per model: a collection found is
 * remembered, later writes cost one set lookup. Models without such options are not checked at all.
 */

/** The fixed options of each root schema (computed on its first write). */
const FIXED = new WeakMap<CompiledSchema, readonly string[]>();

/** The models whose collection was found. */
const FOUND = new WeakSet<OperationTarget>();

/** The operations that create a missing collection whatever their options. */
const CREATING: ReadonlySet<string> = new Set(["insertOne", "insertMany", "bulkWrite"]);

/**
 * The schemas of typed views (`TypedView.define`), with whether the view was found on the server and the
 * check in flight. The server reads a missing view as an empty collection: without this check a view that was
 * never created would silently read as `[]`.
 */
const VIEWS = new WeakMap<CompiledSchema, { found: boolean; pending: Promise<void> | undefined }>();

/** The guard against the implicit creation of a collection whose options must be given at creation. */
export class CollectionGuard {
  /**
   * The options of a schema that MongoDB takes only when the collection is created.
   *
   * @param schema - The compiled schema (its root is used).
   * @returns The option names; empty when there are none.
   */
  static fixedOptions(schema: CompiledSchema): readonly string[] {
    const root = schema.root;
    const cached = FIXED.get(root);
    if (cached !== undefined) return cached;
    const options = root.options;
    const fixed: string[] = [];
    if (options.capped !== undefined) fixed.push("capped");
    if (options.timeseries !== undefined) fixed.push("timeseries");
    if (options.clustered !== undefined) fixed.push("clustered");
    if (options.collation !== undefined) fixed.push("collation");
    const frozen = Object.freeze(fixed);
    FIXED.set(root, frozen);
    return frozen;
  }

  /**
   * Before a write: checks, once per model, that a write that could create the collection finds it.
   *
   * @param ctx - The operation context.
   * @returns `undefined` when nothing has to be checked, else a promise settled when the collection was found.
   * @throws {ConfigurationError} When the collection does not exist and the schema has options it would lose.
   */
  static beforeWrite(ctx: OperationContext): Promise<void> | undefined {
    if (FOUND.has(ctx.target)) return undefined;
    if (!CREATING.has(ctx.op) && (ctx.plan as { readonly upsert?: boolean }).upsert !== true) return undefined;
    if (CollectionGuard.fixedOptions(ctx.target.schema).length === 0) return undefined;
    return CollectionGuard.#check(ctx);
  }

  /**
   * Registers the schema of a typed view: its operations check once that the view exists (`beforeView`).
   *
   * @param schema - The compiled schema of the view class on its connection.
   */
  static watchView(schema: CompiledSchema): void {
    if (!VIEWS.has(schema)) VIEWS.set(schema, { found: false, pending: undefined });
  }

  /**
   * Records what `ensure()` or `drop()` of a typed view did: a created or checked view needs no check, a
   * dropped one is checked again before the next operation.
   *
   * @param schema - The compiled schema of the view class.
   * @param found - Whether the view exists now.
   */
  static viewFound(schema: CompiledSchema, found: boolean): void {
    const view = VIEWS.get(schema);
    if (view !== undefined) view.found = found;
  }

  /**
   * Before an operation of a typed view: the first one (and the first after `drop()`) checks that the view
   * exists — a missing view reads as an empty collection on the server, which would hide a view that was never
   * created. Found once, never checked again (one `listCollections` per view and connection). Anything else:
   * no check, no promise.
   *
   * @param ctx - The operation context.
   * @returns A promise settled when the view was found, or `undefined` when there is nothing to check.
   * @throws {ConfigurationError} When the view does not exist, or the name is a collection, not a view.
   */
  static beforeView(ctx: OperationContext): Promise<void> | undefined {
    const view = VIEWS.get(ctx.target.schema);
    if (view === undefined || view.found) return undefined;
    view.pending ??= CollectionGuard.#checkView(ctx, view).finally(() => {
      view.pending = undefined;
    });
    return view.pending;
  }

  /**
   * Looks the view up (no session: `listCollections` is not allowed inside a transaction).
   *
   * @param ctx - The operation context.
   * @param view - The state of the view.
   * @throws {ConfigurationError} When the view does not exist or is not a view.
   */
  static async #checkView(ctx: OperationContext, view: { found: boolean }): Promise<void> {
    const name = ctx.target.collection;
    const db = ctx.environment.driver.db;
    let info: { readonly type?: string } | undefined;
    try {
      info = (await db.listCollections({ name }).toArray())[0] as { readonly type?: string } | undefined;
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
    const what = OperationView.where(ctx);
    if (info === undefined) {
      throw new ConfigurationError(
        `${what}: the view "${name}" does not exist in the database "${db.databaseName}" (the server would read it as empty); create it first: await connection.init(), or await view.ensure()`,
      );
    }
    if (info.type !== "view") {
      throw new ConfigurationError(
        `${what}: "${name}" is a ${info.type ?? "collection"}, not the view; drop it or rename the view, then create the view`,
      );
    }
    view.found = true;
  }

  /**
   * Before an index command (`syncIndexes`, `createIndexes`, `connection.init()`): creating an index creates a
   * missing collection too.
   *
   * @param db - The database.
   * @param schema - The compiled schema.
   * @param what - The operation, for the message.
   * @returns A promise settled when the collection was found (or the schema has no such options).
   * @throws {ConfigurationError} When the collection does not exist and the schema has options it would lose.
   */
  static async beforeIndexes(db: Db, schema: CompiledSchema, what: string): Promise<void> {
    const fixed = CollectionGuard.fixedOptions(schema);
    if (fixed.length === 0) return;
    if (!(await CollectionGuard.exists(db, schema.root.collection))) throw CollectionGuard.missing(schema, fixed, what);
  }

  /**
   * Whether a collection exists (no session: `listCollections` is not allowed inside a transaction).
   *
   * @param db - The database.
   * @param name - The collection name.
   * @returns `true` when it exists (a view counts: writing to it fails on its own).
   * @throws {TypemoError} The classified driver error when `listCollections` fails.
   */
  static async exists(db: Db, name: string): Promise<boolean> {
    try {
      return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
  }

  /**
   * The check of one model's first write.
   *
   * @param ctx - The operation context.
   * @returns A promise settled when the collection was found.
   * @throws {ConfigurationError} When it does not exist.
   */
  static async #check(ctx: OperationContext): Promise<void> {
    const schema = ctx.target.schema;
    if (!(await CollectionGuard.exists(ctx.environment.driver.db, ctx.target.collection))) {
      throw CollectionGuard.missing(schema, CollectionGuard.fixedOptions(schema), OperationView.where(ctx));
    }
    FOUND.add(ctx.target);
  }

  /**
   * The error of a missing collection.
   *
   * @param schema - The compiled schema.
   * @param fixed - The options the collection would lose.
   * @param what - The operation.
   * @returns The error.
   */
  static missing(schema: CompiledSchema, fixed: readonly string[], what: string): ConfigurationError {
    const root = schema.root;
    const how =
      root.options.autoCreate === false
        ? `the schema says autoCreate: false, so it must be created by whoever owns it, with these options`
        : `create it first: await connection.init(), or await ${root.name}.ensureCollection()`;
    return new ConfigurationError(
      `${what}: the collection "${root.collection}" does not exist, and MongoDB would create it as a plain collection without the options of the schema that can only be given at creation (${fixed.join(", ")}); ${how}`,
    );
  }
}
