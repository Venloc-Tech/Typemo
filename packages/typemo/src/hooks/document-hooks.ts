import { Subdocuments } from "../document/collections/subdocument.ts";
import { DocumentStates } from "../document/document-state.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { ValidationError } from "../errors/validation-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { HookErrors } from "./hook-errors.ts";
import type { DocumentHookEvent } from "./hook-events.ts";
import { HookRegistry } from "./hook-registry.ts";

/**
 * A (sub)document whose pre hooks were attempted; it gets exactly one of `post` or `postError`.
 *
 * @example
 * ```ts
 * const site: HookSite = { self: user, schema: userSchema };
 * ```
 */
export interface HookSite {
  /** The document or subdocument, `this` of its hooks. */
  readonly self: object;
  /** The compiled schema whose hooks run for it. */
  readonly schema: CompiledSchema;
}

/**
 * The (sub)documents whose pre hooks of a document event ran, in order: what `post` and `failed` finish.
 *
 * @example
 * ```ts
 * const attempted: Attempted = [{ self: user, schema: userSchema }];
 * ```
 */
export type Attempted = HookSite[];

/**
 * One subdocument with its schema and code path (`lines.0`, `profile`, `byKey.k`).
 *
 * @example
 * ```ts
 * const site: SubdocumentSite = { subdocument: line, schema: lineSchema, path: "lines.0" };
 * ```
 */
export interface SubdocumentSite {
  /** The subdocument instance. */
  readonly subdocument: object;
  /** The compiled schema of the subdocument. */
  readonly schema: CompiledSchema;
  /** The code path of the subdocument inside the root document. */
  readonly path: string;
}

type Doc = Record<string, unknown>;

/** Cache: whether a schema embeds (transitively) a schema with hooks for an event. */
const EMBEDS = new WeakMap<CompiledSchema, Map<DocumentHookEvent, boolean>>();

/**
 * Runs the document events (`document.*`) of a document and of its subdocuments; `this` is the (sub)document.
 *
 * Subdocument hooks run sequentially in tree order (depth first, in the order of arrays and Maps), never in
 * parallel (Mongoose ran the `saveSubdocs` pre hooks in parallel). Their `validate` hooks end after their own
 * paths are validated:
 *
 * - save: root pre(save), subdocuments pre(save), root pre(validate), subdocuments pre(validate), validation of
 *   the paths, subdocuments post or postError of validate (with the issues under their own path), root post or
 *   postError of validate, the write, subdocuments post(save), root post(save).
 * - delete: root pre(deleteOne), subdocuments pre(deleteOne), the write, subdocuments post, root post.
 * - init (after a read hydrated the document): root pre(init), subdocuments pre(init), subdocuments post(init),
 *   root post(init).
 *
 * Every (sub)document whose pre hooks were attempted ends in exactly one of post or postError. Nested objects
 * (`@Schema({ nested: true })`) have no hooks of their own but are walked into.
 */
export class DocumentHooks {
  /**
   * Tells whether some subdocument schema of `schema` has hooks for an event, at any depth and discriminators
   * included. The answer is cached per schema.
   *
   * @param schema - The compiled schema to look through.
   * @param event - The document hook event.
   * @returns `true` when an embedded schema has a hook for `event` in any phase.
   */
  static embeds(schema: CompiledSchema, event: DocumentHookEvent): boolean {
    let byEvent = EMBEDS.get(schema);
    if (byEvent === undefined) {
      byEvent = new Map();
      EMBEDS.set(schema, byEvent);
    }
    const known = byEvent.get(event);
    if (known !== undefined) return known;
    let found = false;
    for (const one of [schema, ...schema.discriminators.values()]) {
      for (const node of Object.values(one.allPaths)) {
        if (node.kind !== "subdocument") continue;
        if ([node.schema, ...node.schema.discriminators.values()].some((sub) => HookRegistry.has(sub, event))) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    byEvent.set(event, found);
    return found;
  }

  /**
   * The subdocuments of a document, in tree order, whose schema has hooks for an event.
   *
   * @param document - The root document.
   * @param schema - The root's compiled schema.
   * @param event - The document hook event.
   * @returns The subdocument sites (empty when no embedded schema has such hooks).
   */
  static subdocuments(document: object, schema: CompiledSchema, event: DocumentHookEvent): SubdocumentSite[] {
    if (!DocumentHooks.embeds(schema, event)) return [];
    const out: SubdocumentSite[] = [];
    const visit = (value: unknown, path: string): void => {
      if (value === null || typeof value !== "object") return;
      if (Subdocuments.isSubdocument(value)) {
        const own = Subdocuments.schemaOf(value);
        if (own.kind === "document" && HookRegistry.has(own, event))
          out.push({ subdocument: value, schema: own, path });
        DocumentHooks.fields(value as Doc, own, path, visit);
        return;
      }
      if (Array.isArray(value)) {
        for (const [index, item] of (value as readonly unknown[]).entries()) visit(item, `${path}.${index}`);
        return;
      }
      if (value instanceof Map) for (const [key, item] of value) visit(item, `${path}.${String(key)}`);
    };
    DocumentHooks.fields(document as Doc, schema, "", visit);
    return out;
  }

  /**
   * Visits the fields of an owner that can hold subdocuments (subdocument, nested, array, map fields).
   *
   * @param owner - The document or subdocument.
   * @param schema - Its compiled schema.
   * @param prefix - The code path of the owner (`""` for the root).
   * @param visit - Called with each such field value and its code path.
   */
  private static fields(
    owner: Doc,
    schema: CompiledSchema,
    prefix: string,
    visit: (value: unknown, path: string) => void,
  ): void {
    for (const node of schema.fields) {
      if (node.kind !== "subdocument" && node.kind !== "nested" && node.kind !== "array" && node.kind !== "map")
        continue;
      if (!Object.hasOwn(owner, node.key)) continue;
      visit(owner[node.key], prefix === "" ? node.key : `${prefix}.${node.key}`);
    }
  }

  /**
   * Runs `pre` of an event on the root and its subdocuments, then `work`, then `post` (subdocuments first, then the
   * root). A failure anywhere runs `postError` on every (sub)document whose pre hooks were attempted, and rethrows.
   *
   * @param schema - The root's compiled schema.
   * @param document - The root document.
   * @param event - The document hook event.
   * @param work - The operation the hooks wrap.
   * @param postArg - Gives each (sub)document's argument for its post hooks.
   * @param afterWrite - Maps the failure of a post hook (the work is done), e.g. to a `PostHookError`.
   * @returns The result of `work`.
   * @throws Whatever a hook or `work` throws, after the `postError` hooks ran.
   */
  static async around<R>(
    schema: CompiledSchema,
    document: object,
    event: DocumentHookEvent,
    work: () => Promise<R>,
    postArg: (self: object, result: R) => unknown,
    afterWrite?: (error: unknown, result: R) => unknown,
  ): Promise<R> {
    const attempted: Attempted = [];
    let result: R;
    try {
      await DocumentHooks.pre(schema, document, event, attempted);
      result = await work();
    } catch (error) {
      await DocumentHooks.failed(attempted, event, error);
      throw error;
    }
    try {
      await DocumentHooks.post(attempted, event, (self) => postArg(self, result));
    } catch (error) {
      throw afterWrite === undefined ? error : afterWrite(error, result);
    }
    return result;
  }

  /**
   * Runs the pre hooks of an event: the root, then its subdocuments. Each (sub)document is added to `attempted`
   * before its hooks run, so a failing hook still gets its `postError`.
   *
   * @param schema - The root's compiled schema.
   * @param document - The root document.
   * @param event - The document hook event.
   * @param attempted - Collects the sites whose pre hooks were attempted.
   * @returns A promise that settles when the pre hooks have run.
   */
  static async pre(
    schema: CompiledSchema,
    document: object,
    event: DocumentHookEvent,
    attempted: Attempted,
  ): Promise<void> {
    const subs = DocumentHooks.subdocuments(document, schema, event);
    attempted.push({ self: document, schema });
    await HookRegistry.document(schema, event, "pre", document, []);
    for (const sub of subs) {
      attempted.push({ self: sub.subdocument, schema: sub.schema });
      await HookRegistry.document(sub.schema, event, "pre", sub.subdocument, []);
    }
  }

  /**
   * Runs the post hooks of the attempted (sub)documents: subdocuments first, then their root.
   *
   * @param attempted - The sites whose pre hooks were attempted.
   * @param event - The document hook event.
   * @param argOf - Gives the argument of a site's post hooks.
   * @returns A promise that settles when the post hooks have run.
   */
  static async post(attempted: Attempted, event: DocumentHookEvent, argOf: (self: object) => unknown): Promise<void> {
    for (const entry of DocumentHooks.finishOrder(attempted)) {
      await HookRegistry.document(entry.schema, event, "post", entry.self, [argOf(entry.self)]);
    }
  }

  /**
   * Runs `document.validate` hooks around validation, including the subdocuments whose paths are validated. Each
   * subdocument's `post` or `postError` reports only its own issues.
   *
   * @param schema - The root's compiled schema.
   * @param document - The root document.
   * @param paths - The modified code paths, or `"all"` for a new document or `$validate()`.
   * @param validate - Runs the actual validation.
   * @returns A promise that settles when validation and the hooks are done.
   * @throws Whatever `validate` or a hook throws, after the `postError` hooks ran.
   */
  static async validate(
    schema: CompiledSchema,
    document: object,
    paths: "all" | readonly string[],
    validate: () => Promise<void>,
  ): Promise<void> {
    const covered = (path: string): boolean =>
      paths === "all" ||
      paths.some((modified) => modified === path || modified.startsWith(`${path}.`) || path.startsWith(`${modified}.`));
    const subs = DocumentHooks.subdocuments(document, schema, "document.validate").filter((sub) => covered(sub.path));
    const attempted: { readonly self: object; readonly schema: CompiledSchema; readonly path: string }[] = [];
    try {
      attempted.push({ self: document, schema, path: "" });
      await HookRegistry.document(schema, "document.validate", "pre", document, []);
      for (const sub of subs) {
        attempted.push({ self: sub.subdocument, schema: sub.schema, path: sub.path });
        await HookRegistry.document(sub.schema, "document.validate", "pre", sub.subdocument, []);
      }
      await validate();
    } catch (error) {
      try {
        await DocumentHooks.validateFailed(schema, document, attempted, error);
      } catch (thrown) {
        throw HookErrors.chain(thrown, error);
      }
      throw error;
    }
    for (const sub of subs) {
      await HookRegistry.document(sub.schema, "document.validate", "post", sub.subdocument, [sub.subdocument]);
    }
    await HookRegistry.document(schema, "document.validate", "post", document, [document]);
  }

  /**
   * The ends of a failed validation: every attempted subdocument gets `post` (no issue of its own) or `postError`
   * (its own issues), then the root gets `postError`.
   *
   * @param schema - The root's compiled schema.
   * @param document - The root document.
   * @param attempted - The sites whose pre hooks ran, the root first.
   * @param error - The failure.
   * @returns A promise that settles when the hooks have run.
   */
  private static async validateFailed(
    schema: CompiledSchema,
    document: object,
    attempted: readonly { readonly self: object; readonly schema: CompiledSchema; readonly path: string }[],
    error: unknown,
  ): Promise<void> {
    const issues = error instanceof ValidationError ? error.issues : undefined;
    for (const entry of attempted.slice(1)) {
      const own =
        issues?.filter((issue) => {
          const path = issue.path.join(".");
          return path === entry.path || path.startsWith(`${entry.path}.`);
        }) ?? [];
      if (issues !== undefined && own.length === 0) {
        await HookRegistry.document(entry.schema, "document.validate", "post", entry.self, [entry.self]);
      } else {
        await HookRegistry.document(entry.schema, "document.validate", "postError", entry.self, [
          issues === undefined ? error : new ValidationError(own),
        ]);
      }
    }
    await HookRegistry.document(schema, "document.validate", "postError", document, [error]);
  }

  /**
   * Tells whether documents of a schema, its discriminators or their subdocuments have `document.init` hooks.
   *
   * @param schema - The compiled schema.
   * @returns `true` when any `document.init` hook exists.
   */
  static hasInit(schema: CompiledSchema): boolean {
    return [schema, ...schema.discriminators.values()].some(
      (one) => HookRegistry.has(one, "document.init") || DocumentHooks.embeds(one, "document.init"),
    );
  }

  /**
   * Runs `document.init` of hydrated documents and their subdocuments, one document after another.
   *
   * @param documents - The documents a read hydrated; values that are not hydrated documents are skipped.
   * @returns A promise that settles when all hooks have run.
   * @throws Whatever an init hook throws.
   */
  static async init(documents: readonly unknown[]): Promise<void> {
    for (const document of documents) {
      if (!DocumentStates.is(document)) continue;
      const schema = DocumentStates.of(document).schema;
      if (!HookRegistry.has(schema, "document.init") && !DocumentHooks.embeds(schema, "document.init")) continue;
      await DocumentHooks.around(
        schema,
        document,
        "document.init",
        async () => undefined,
        (self) => self,
      );
    }
  }

  /**
   * Runs `document.init` for a synchronous hydration (`model.hydrate()`). The hooks run at once; the caller cannot
   * wait, so a hook that returns a promise is an error (read the document with a query instead).
   *
   * @param document - The hydrated document.
   * @throws {ConfigurationError} When an init hook returns a promise.
   */
  static initSync(document: object): void {
    const schema = DocumentStates.of(document).schema;
    if (!HookRegistry.has(schema, "document.init") && !DocumentHooks.embeds(schema, "document.init")) return;
    const sites = [
      { self: document, schema },
      ...DocumentHooks.subdocuments(document, schema, "document.init").map((sub) => ({
        self: sub.subdocument,
        schema: sub.schema,
      })),
    ];
    const call = (phase: "pre" | "post", site: { readonly self: object; readonly schema: CompiledSchema }): void => {
      for (const hook of HookRegistry.list(site.schema, "document.init", phase)) {
        const out = (hook as (this: object, ...args: unknown[]) => unknown).apply(
          site.self,
          phase === "post" ? [site.self] : [],
        );
        if (typeof out === "object" && out !== null && typeof (out as { then?: unknown }).then === "function") {
          throw new ConfigurationError(
            `${site.schema.name}: an async document.init hook cannot run in the synchronous hydrate(); read the document with a query`,
          );
        }
      }
    };
    for (const site of sites) call("pre", site);
    for (const site of [...sites.slice(1), sites[0] as (typeof sites)[number]]) call("post", site);
  }

  /**
   * Runs the `postError` hooks of every attempted (sub)document: subdocuments first, then their root.
   *
   * @param attempted - The sites whose pre hooks were attempted.
   * @param event - The document hook event.
   * @param error - The error passed to the hooks.
   * @returns A promise that settles when the hooks have run.
   * @throws The error of a failing `postError` hook, with `error` as its cause.
   */
  static async failed(attempted: Attempted, event: DocumentHookEvent, error: unknown): Promise<void> {
    for (const entry of DocumentHooks.finishOrder(attempted)) {
      try {
        await HookRegistry.document(entry.schema, event, "postError", entry.self, [error]);
      } catch (thrown) {
        /* The hook's failure is thrown, the error it handled kept as its cause. */
        throw HookErrors.chain(thrown, error);
      }
    }
  }

  /**
   * The order post hooks finish in: for each root (a site whose `self` is a hydrated document), its subdocuments in
   * tree order, then the root itself. With `bulkSave` this goes document after document.
   *
   * @param attempted - The sites whose pre hooks were attempted.
   * @returns The sites in finishing order.
   */
  private static finishOrder(attempted: Attempted): Attempted {
    const out: Attempted = [];
    let root: HookSite | undefined;
    for (const entry of attempted) {
      if (DocumentStates.is(entry.self)) {
        if (root !== undefined) out.push(root);
        root = entry;
      } else out.push(entry);
    }
    if (root !== undefined) out.push(root);
    return out;
  }
}
