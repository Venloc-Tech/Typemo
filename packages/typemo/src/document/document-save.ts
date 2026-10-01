import type { ClientSession } from "mongodb";
import { TransactionContext } from "../connection/transaction-context.ts";
import type { TransactionScope } from "../connection/transaction-scope.ts";
import { BulkWriteError, type BulkWriteSummary } from "../errors/bulk-write-error.ts";
import { CastError } from "../errors/cast-error.ts";
import { DocumentNotFoundError } from "../errors/document-not-found-error.ts";
import { PostHookError } from "../errors/post-hook-error.ts";
import { QueryError } from "../errors/query-error.ts";
import { TypemoError } from "../errors/typemo-error.ts";
import { VersionError } from "../errors/version-error.ts";
import { BulkUnits } from "../hooks/bulk-unit-hooks.ts";
import { type Attempted, DocumentHooks } from "../hooks/document-hooks.ts";
import { HookErrors } from "../hooks/hook-errors.ts";
import { HookRegistry } from "../hooks/hook-registry.ts";
import type { Model } from "../model/model.ts";
import { ModelInternals } from "../model/model-internals.ts";
import type { BulkWriteModel, BulkWritePlan, ExecutionPlan, InsertPlan } from "../operation/pipeline/execution-plan.ts";
import type { DocumentPrepare, DocumentWrite } from "../operation/pipeline/operation-context.ts";
import type { StepName } from "../operation/pipeline/operation-step.ts";
import { PolicyContext } from "../policies/policy-context.ts";
import { SoftDeletePolicy } from "../policies/soft-delete-policy.ts";
import { TenantPolicy } from "../policies/tenant-policy.ts";
import type { PlanDocument, PlanOptions, WritePlan } from "../query/plan.ts";
import { UpdatePlanner } from "../query/update-planner.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import type { DeleteResult, UpdateResult } from "../types/result.ts";
import { ChangeTracker } from "./change-tracker.ts";
import { Collections, type CommitMark } from "./collections/collections.ts";
import { FieldBaseline } from "./collections/field-baseline.ts";
import type { FoundUnknown } from "./collections/tracked-protocol.ts";
import { UpdateOps, type UpdateParts } from "./collections/update-ops.ts";
import { Delta, type DocumentDelta } from "./delta.ts";
import { DocumentSerializer } from "./document-serializer.ts";
import { DocumentSnapshots } from "./document-snapshot.ts";
import { type DocumentState, DocumentStates } from "./document-state.ts";
import type { SaveOptions } from "./document-types.ts";
import { DocumentValidation } from "./document-validation.ts";
import { PopulatedFields } from "./populated-fields.ts";
import { Versioning } from "./versioning.ts";

/**
 * A document as a bag of fields.
 *
 * @example
 * ```ts
 * const doc: Doc = { name: "Ada" };
 * ```
 */
type Doc = Record<string, unknown>;

/**
 * The state sent by a write, committed when it succeeds (taken together with the update).
 *
 * @example
 * ```ts
 * const sent: Sent = { values: new Map([["name", "Ada"]]), marks: new Map(), marked: new Set() };
 * ```
 */
interface Sent {
  /** Own field values at build time (the next baseline); the core's stamps are added to it. */
  readonly values: Map<string, unknown>;
  /** The journals of the tracked field values that the write sends (`Collections.mark`). */
  readonly marks: ReadonlyMap<string, CommitMark>;
  /** The `$markModified` paths the write covers (one added in flight stays). */
  readonly marked: ReadonlySet<string>;
}

/**
 * A document write, ready to be sent.
 *
 * @example
 * ```ts
 * const prepared: Prepared = { kind: "none" };
 * ```
 */
type Prepared =
  | { readonly kind: "none" }
  | { readonly kind: "insert"; readonly document: PlanDocument; readonly sent: Sent }
  | {
      readonly kind: "update";
      readonly filter: PlanDocument;
      readonly update: PlanDocument;
      readonly versioned: boolean;
      readonly increment: boolean;
      readonly modifiedPaths: readonly string[];
      /** Stored subdocuments whose unknown fields this (accepted) update drops. */
      readonly unknown: readonly FoundUnknown[];
      readonly sent: Sent;
    };

/**
 * A write that nothing sends yet: the save's values come from its preparation inside the operation.
 *
 * @example
 * ```ts
 * const ready: Ready = (await DocumentSave.prepare(document, state, {}, "save")) as Ready;
 * ```
 */
type Ready = Exclude<Prepared, { readonly kind: "none" }>;

/**
 * The synchronous start of a preparation (see `DocumentSave.begin`).
 *
 * @example
 * ```ts
 * const begun: Begun = { kind: "insert" };
 * ```
 */
type Begun =
  | { readonly kind: "none" }
  | { readonly kind: "insert" }
  | {
      readonly kind: "update";
      readonly delta: DocumentDelta;
      readonly sent: Sent;
    };

/** The placeholder values of a save's plan (the preparation fills the operation's own). */
const PENDING: PlanDocument = Object.freeze({});
/** The values of the plan of a write that failed before its steps: only its name and options matter. */
const NOTHING: PlanDocument = Object.freeze({});

/** A write of the document's own values, cast and validated by the document layer (`$deleteOne`, `bulkSave`). */
const DOCUMENT_VALUES: DocumentWrite = Object.freeze({ kind: "values" });
/** `$updateOne`: an ordinary update (cast, validated), but the document's hooks, not the query's. */
const DOCUMENT_HOOKS: DocumentWrite = Object.freeze({ kind: "hooks" });

/** The enlisted participant of a document in a transaction attempt (one per document and attempt). */
const ENLISTED = new WeakMap<object, { readonly scope: TransactionScope; readonly attempt: number }>();

/**
 * Document writes: `save()`, `bulkSave()`, `$deleteOne()` and `$updateOne()`. ONE execution path: the write
 * is a plan (`insertOne` / `updateOne` / `bulkWrite` / `deleteOne`) run by the document's model through the
 * connection's operation pipeline — session (explicit, the document's, or the ambient transaction's),
 * policies (strict paths, immutable fields: `createdAt` cannot be overwritten, Mongoose H413), `dbName`,
 * encoding, instrumentation and error classification are the same as for any query. The plan is marked as a
 * document write (`OperationContext.document`, kind `"values"`): the values are already cast and validated,
 * and the `document.*` hooks run here, not the query ones.
 *
 * The save, step by step:
 *  1. refused: a deleted document, a save of the same document still in flight;
 *  2. transaction: the document enlists in the attempt (snapshot for the rollback);
 *  3. `pre('save')` hooks (`this` = the document);
 *  4. directly assigned scalars are cast once (their failures join the validation, Mongoose H508);
 *  5. new: every field is validated (`pre/post('validate')`), then `createdAt`/`updatedAt`/`__v = 0` are
 *     set and the document is inserted (schema defaults were applied at creation; `minimize` off);
 *  6. existing: the delta — nothing changed: NOTHING is sent (no `findOne`, unlike Mongoose); else the
 *     modified paths are validated (changes of the hooks included), `updatedAt` is set, the version plan
 *     applies, the filter is `{ _id, <shard key as read>, [__v] }`;
 *  7. after the write: no match with the version in the filter → one read by `_id` tells `VersionError`
 *     from `DocumentNotFoundError` (Mongoose H506 did nothing); success → the new baseline is the state
 *     that was SENT. The state to send is taken at the moment the update (or the insert) is BUILT, in
 *     one synchronous step with it: root values, forced paths and the collections' journals
 *     (`Collections.mark`). Anything changed after that — during async validation or while the write
 *     is in flight, root field, array, Map or subdocument alike — stays a change for the next save
 *     (Mongoose H500); a failed write gives the journals back (`Collections.unmark`);
 *  8. `post('save')` hooks; on failure `postError` hooks, then the error.
 *
 * The hooks of the subdocuments run with the document's (`DocumentHooks`: sequential, tree order, validate
 * hooks after their own paths), and every (sub)document whose pre hooks were attempted ends in exactly one
 * of post / postError — also when a pre hook itself failed.
 */
export class DocumentSave {
  /**
   * `$save(options)`.
   *
   * @param document - The hydrated document.
   * @param options - Session, timeout and policy of the write.
   * @param given - Extra plan options set by the caller (`method`: the method the user called; `save` by default).
   * @returns The saved document.
   * @throws {QueryError} When the document is deleted, or another save of it is in flight.
   * @throws {ValidationError} When the document is invalid.
   * @throws {VersionError} When the version in the filter matched no document.
   * @throws {DocumentNotFoundError} When the document no longer exists.
   * @throws {UnknownFieldsError} When the save would drop unknown stored fields.
   */
  static async save(document: object, options: SaveOptions = {}, given: Partial<PlanOptions> = {}): Promise<object> {
    /* The operation is named after the method the user called: `$save`, or `create`/`insertOne` that save. */
    const extra: Partial<PlanOptions> = { method: "save", ...given };
    const method = extra.method ?? "save";
    const state = DocumentStates.of(document);
    DocumentSave.checkWritable(state, "save");
    state.saving = true;
    const attempted: Attempted = [];
    /* The operation that was sent, if any (for the error of a failing post hook). */
    let written: "insertOne" | "updateOne" | undefined;
    try {
      DocumentSave.enlist(document, options);
      try {
        await DocumentHooks.pre(state.schema, document, "document.save", attempted);
      } catch (error) {
        /* A failed pre('save') hook is the operation's failure at `hooksPre` (nothing is sent). */
        const op = state.isNew ? "insertOne" : "updateOne";
        throw await DocumentSave.reportFailed(DocumentSave.model(state), op, state, options, extra, error, "hooksPre");
      }
      let begun: Begun;
      try {
        begun = DocumentSave.begin(document, state, options);
      } catch (error) {
        if (!(error instanceof CastError)) throw error;
        /* A directly assigned value that cannot be cast is the operation's failure at `cast` (nothing is sent). */
        const op = state.isNew ? "insertOne" : "updateOne";
        throw await DocumentSave.reportFailed(DocumentSave.model(state), op, state, options, extra, error, "cast");
      }
      if (begun.kind !== "none") {
        const model = DocumentSave.model(state);
        const planOptions = DocumentSave.options(state, options, extra);
        /* The validation runs INSIDE the operation (its failure is an `operation.error` at `validate`); the
           plan's values are filled from it. Once per save, also when an audit transaction runs the operation
           again. */
        const box: { pending?: Promise<Ready>; ready?: Ready } = {};
        const prepare: DocumentPrepare = async (ctx) => {
          box.pending ??= DocumentSave.finish(document, state, options, begun, method);
          const ready = await box.pending;
          box.ready = ready;
          if (ready.kind === "insert") ctx.documents = Object.freeze([ready.document]);
          else {
            ctx.filter = ready.filter;
            ctx.update = ready.update;
          }
        };
        const write: DocumentWrite = Object.freeze({ kind: "values", prepare });
        try {
          if (begun.kind === "insert") {
            const plan: InsertPlan = Object.freeze({
              op: "insertOne",
              entity: model.entity as EntityClass,
              documents: Object.freeze([PENDING]),
              ordered: true,
              options: planOptions,
            });
            const inserted = (await model.runDocument(plan, write)) as Doc;
            written = "insertOne";
            DocumentSave.commitInsert(document, state, (box.ready as Ready).sent, inserted);
          } else {
            const plan: WritePlan = Object.freeze({
              op: "updateOne",
              entity: model.entity as EntityClass,
              filter: PENDING,
              update: PENDING,
              upsert: false,
              orFail: false,
              options: planOptions,
            });
            const result = (await model.runDocument(plan, write)) as { readonly matchedCount: number };
            const ready = box.ready as Extract<Ready, { kind: "update" }>;
            if (result.matchedCount === 0) await DocumentSave.notMatched(document, state, ready, planOptions);
            written = "updateOne";
            DocumentSave.commitUpdate(document, state, ready.sent, ready.increment);
            Collections.forgetUnknown(ready.unknown);
          }
        } catch (error) {
          /* A failed preparation gave its journals back itself; one that never ran must give back the update's. */
          if (box.ready !== undefined) DocumentSave.release(box.ready.sent);
          else if (box.pending === undefined && begun.kind === "update") DocumentSave.release(begun.sent);
          throw error;
        }
      }
    } catch (error) {
      state.saving = false;
      await DocumentHooks.failed(attempted, "document.save", error);
      throw error;
    }
    state.saving = false;
    try {
      await DocumentHooks.post(attempted, "document.save", (self) => self);
    } catch (error) {
      /* Nothing was sent when nothing changed: the hook's error is all there is. */
      if (written === undefined) throw error;
      throw HookErrors.afterWrite(
        state.schema.name,
        method,
        document,
        error,
        DocumentSave.transactional(state, options),
      );
    }
    return document;
  }

  /**
   * `$validate()`: every loaded field, with the `document.validate` hooks.
   *
   * @param document - The hydrated document.
   * @returns Resolves when the document is valid.
   * @throws {CastError} When a directly assigned value cannot be cast (its constraints are not checked then).
   * @throws {ValidationError} With every issue found.
   */
  static async validate(document: object): Promise<void> {
    const state = DocumentStates.of(document);
    ChangeTracker.castAssigned(document, state);
    await DocumentHooks.validate(state.schema, document, "all", () => DocumentValidation.validate(document, "all", []));
  }

  /**
   * `$deleteOne(options)`: by `_id`, with the `document.deleteOne` hooks.
   *
   * @param document - The hydrated document.
   * @param options - Session, timeout and policy of the write.
   * @returns The delete result.
   * @throws {QueryError} When the document is deleted, or a save of it is in flight.
   */
  static async deleteOne(document: object, options: SaveOptions = {}): Promise<DeleteResult> {
    const state = DocumentStates.of(document);
    DocumentSave.checkWritable(state, "deleteOne");
    DocumentSave.enlist(document, options);
    return DocumentHooks.around(
      state.schema,
      document,
      "document.deleteOne",
      async () => {
        const model = DocumentSave.model(state);
        const plan: WritePlan = Object.freeze({
          op: "deleteOne",
          entity: model.entity as EntityClass,
          filter: DocumentSave.filter(document, state, false),
          upsert: false,
          orFail: false,
          options: DocumentSave.options(state, options, {}),
        });
        const result = (await model.runDocument(plan, DOCUMENT_VALUES)) as DeleteResult;
        state.deleted = true;
        return result;
      },
      (_self, result) => result,
      (error, result) =>
        HookErrors.afterWrite(
          state.schema.name,
          "deleteOne",
          result,
          error,
          DocumentSave.transactional(state, options),
        ),
    );
  }

  /**
   * `$updateOne(update, options)`: an update of this document by `_id` (the shard key as read) through the
   * model's pipeline — cast, validators, policies, audit like any update — with the `document.updateOne` hooks
   * around it (`this` = the document; the query hooks do not fire). The document in memory is not changed (as
   * in Mongoose): read it again to see the result.
   *
   * @param document - The hydrated document.
   * @param update - The update document.
   * @param options - Session, timeout and policy of the write.
   * @returns The update result.
   * @throws {QueryError} When the document is new, deleted, or a save of it is in flight.
   */
  static async updateOne(document: object, update: unknown, options: SaveOptions = {}): Promise<UpdateResult<unknown>> {
    const state = DocumentStates.of(document);
    DocumentSave.checkWritable(state, "updateOne");
    if (state.isNew) throw new QueryError(`updateOne: the ${state.schema.name} document is new; $save() it first`);
    const planned = UpdatePlanner.plan(update, undefined);
    DocumentSave.enlist(document, options);
    return DocumentHooks.around(
      state.schema,
      document,
      "document.updateOne",
      async () => {
        const model = DocumentSave.model(state);
        const plan: WritePlan = Object.freeze({
          op: "updateOne",
          entity: model.entity as EntityClass,
          filter: DocumentSave.filter(document, state, false),
          ...planned,
          upsert: false,
          orFail: false,
          options: DocumentSave.options(state, options, {}),
        });
        return (await model.runDocument(plan, DOCUMENT_HOOKS)) as UpdateResult<unknown>;
      },
      (_self, result) => result,
      (error, result) =>
        HookErrors.afterWrite(
          state.schema.name,
          "updateOne",
          result,
          error,
          DocumentSave.transactional(state, options),
        ),
    );
  }

  /**
   * `model.bulkSave(documents)`: every document through the SAME preparation as `save` (hooks, cast,
   * delta, validation with async validators, versioning, shard key as read), then ONE ordered
   * `bulkWrite` through the pipeline. Documents with nothing to write send nothing.
   *
   * @param model - The model the documents belong to.
   * @param documents - The hydrated documents.
   * @param options - Session, timeout and policy of the write.
   * @param given - Extra plan options set by the caller (`method`: the method the user called; `bulkSave` by default).
   * @returns The bulk write result, or `undefined` when no document had anything to write.
   * @throws {QueryError} When a document belongs to another model, is deleted, or is being saved.
   * @throws {VersionError} When a versioned update matched no document.
   * @throws {DocumentNotFoundError} When an updated document no longer exists.
   */
  static async bulkSave<R>(
    model: Model<object>,
    documents: readonly object[],
    options: SaveOptions = {},
    given: Partial<PlanOptions> = {},
  ): Promise<R | undefined> {
    /* The operation is named after the method the user called: `bulkSave`, or `create([...])` that saves. */
    const extra: Partial<PlanOptions> = { method: "bulkSave", ...given };
    const method = extra.method ?? "bulkSave";
    const states = documents.map((document) => {
      const state = DocumentStates.of(document);
      if (state.schema !== ModelInternals.schema(model) && state.schema.root !== ModelInternals.schema(model).root) {
        throw new QueryError(`bulkSave: a document of ${state.schema.name} is not a document of ${model.modelName}`);
      }
      DocumentSave.checkWritable(state, "bulkSave");
      return state;
    });
    const operations: BulkWriteModel[] = [];
    const planned: { document: object; state: DocumentState; prepared: Prepared; sent: Sent }[] = [];
    /* Every document's pre hooks (and its subdocuments'), one document after another (Mongoose ran them in
       parallel and skipped postError); a failure ends ALL attempted in postError. */
    const attempted: Attempted = [];
    const releaseAll = async (error: unknown): Promise<void> => {
      for (const entry of planned) DocumentSave.release(entry.sent);
      await DocumentHooks.failed(attempted, "document.save", error);
    };
    for (const [index, document] of documents.entries()) {
      const state = states[index] as DocumentState;
      let prepared: Prepared;
      try {
        DocumentSave.enlist(document, options);
      } catch (error) {
        await releaseAll(error);
        throw error;
      }
      try {
        await DocumentHooks.pre(state.schema, document, "document.save", attempted);
      } catch (error) {
        /* A failed pre('save') hook is the bulk's operation failure at `hooksPre`. */
        const first = states[0] as DocumentState;
        const failure = await DocumentSave.reportFailed(model, "bulkWrite", first, options, extra, error, "hooksPre");
        await releaseAll(failure);
        throw failure;
      }
      try {
        prepared = await DocumentSave.prepare(document, state, options, method);
      } catch (error) {
        const first = states[0] as DocumentState;
        const step = error instanceof CastError ? "cast" : "validate";
        const failure = await DocumentSave.reportFailed(model, "bulkWrite", first, options, extra, error, step);
        await releaseAll(failure);
        throw failure;
      }
      if (prepared.kind === "none") continue;
      planned.push({ document, state, prepared, sent: prepared.sent });
      operations.push(
        prepared.kind === "insert"
          ? { insertOne: { document: prepared.document } }
          : { updateOne: { filter: prepared.filter, update: prepared.update } },
      );
    }
    if (operations.length === 0) {
      await DocumentHooks.post(attempted, "document.save", (self) => self);
      return undefined;
    }
    const plan: BulkWritePlan = Object.freeze({
      op: "bulkWrite",
      entity: model.entity as EntityClass,
      operations: Object.freeze(operations),
      ordered: true,
      options: DocumentSave.options(states[0] as DocumentState, options, extra),
    });
    let result: { readonly matchedCount: number; readonly insertedIds: Readonly<Record<number, unknown>> } & R;
    const updates = planned.filter((entry) => entry.prepared.kind === "update");
    let failed: Set<object>;
    try {
      result = (await model.runDocument(plan, DOCUMENT_VALUES)) as typeof result;
      failed =
        result.matchedCount < updates.length
          ? await DocumentSave.unmatched(model, updates, plan.options)
          : new Set<object>();
    } catch (error) {
      await releaseAll(error);
      throw error;
    }
    planned.forEach((entry, index) => {
      if (failed.has(entry.document)) {
        DocumentSave.release(entry.sent);
        return;
      }
      if (entry.prepared.kind === "insert") {
        DocumentSave.commitInsert(entry.document, entry.state, entry.sent, { _id: result.insertedIds[index] });
      } else if (entry.prepared.kind === "update") {
        DocumentSave.commitUpdate(entry.document, entry.state, entry.sent, entry.prepared.increment);
        Collections.forgetUnknown(entry.prepared.unknown);
      }
    });
    if (failed.size > 0) {
      const first = [...failed][0] as object;
      const state = DocumentStates.of(first);
      const entry = updates.find((candidate) => candidate.document === first);
      const error =
        entry !== undefined && entry.prepared.kind === "update" && entry.prepared.versioned
          ? new VersionError(state.schema.name, state.version ?? 0, entry.prepared.modifiedPaths)
          : DocumentSave.gone(method, state);
      await DocumentHooks.failed(attempted, "document.save", error);
      throw error;
    }
    try {
      await DocumentHooks.post(attempted, "document.save", (self) => self);
    } catch (error) {
      throw HookErrors.afterWrite(
        model.modelName,
        method,
        result,
        error,
        DocumentSave.transactional(states[0], options),
      );
    }
    return result;
  }

  /**
   * `model.insertMany(docs)`: every input becomes a new document that goes through the preparation of `save`
   * (`pre('save')`, the policies' stamps, the validation with its `document.validate` hooks, timestamps and
   * version), one document after another, then ONE `insertMany` through the pipeline with the operation's own
   * `model.insertMany` event. Ordered: the first invalid document fails the operation and nothing is sent.
   * Unordered: an invalid document is left out and reported in the `BulkWriteError` with the server's failures;
   * the others are inserted. Every document whose pre hooks were attempted ends in exactly one of `post` (it is
   * stored) or `postError` (it is not).
   *
   * @param model - The model the documents are created by.
   * @param inputs - The documents as given (plain objects).
   * @param ordered - Whether the insert stops at the first failure.
   * @param options - Session and policy of the write, as `save` takes them.
   * @param planOptions - The plan options of the operation.
   * @returns The inserted documents, in input order.
   * @throws {CastError} Ordered: when an input cannot be cast.
   * @throws {ValidationError} Ordered: when a document is invalid.
   * @throws {BulkWriteError} When a write failed, or (unordered) when some documents were left out.
   */
  static async insertMany(
    model: Model<object>,
    inputs: readonly PlanDocument[],
    ordered: boolean,
    options: SaveOptions,
    planOptions: PlanOptions,
  ): Promise<object[]> {
    interface Entry {
      readonly document: object;
      readonly state: DocumentState;
      readonly attempted: Attempted;
      sent?: Sent;
      rejected?: TypemoError;
      committed: boolean;
    }
    const entries = new Map<number, Entry>();
    const uncast = new Map<number, TypemoError>();
    const stage: { step: StepName } = { step: "validate" };
    const box: { pending?: Promise<readonly PlanDocument[]> } = {};
    /* Once per operation, also when an audit transaction runs the operation again. */
    const build = async (): Promise<readonly PlanDocument[]> => {
      const documents: PlanDocument[] = [];
      for (const index of inputs.keys()) {
        const entry = entries.get(index);
        if (entry === undefined) {
          documents.push(PENDING);
          continue;
        }
        DocumentSave.enlist(entry.document, options);
        stage.step = "hooksPre";
        await DocumentHooks.pre(entry.state.schema, entry.document, "document.save", entry.attempted);
        stage.step = "validate";
        try {
          const prepared = (await DocumentSave.prepare(entry.document, entry.state, options, "insertMany")) as Extract<
            Prepared,
            { kind: "insert" }
          >;
          entry.sent = prepared.sent;
          documents.push(prepared.document);
        } catch (error) {
          if (ordered || !(error instanceof TypemoError)) throw error;
          entry.rejected = error;
          documents.push(PENDING);
        }
      }
      return Object.freeze(documents);
    };
    const prepare: DocumentPrepare = async (ctx) => {
      box.pending ??= build();
      ctx.documents = await box.pending;
      for (const [index, error] of uncast) ctx.reject(index, error);
      for (const [index, entry] of entries) if (entry.rejected !== undefined) ctx.reject(index, entry.rejected);
    };
    const commit = (entry: Entry, stored: Doc): void => {
      if (entry.committed || entry.sent === undefined) return;
      DocumentSave.commitInsert(entry.document, entry.state, entry.sent, stored);
      entry.committed = true;
    };
    const write: DocumentWrite = Object.freeze({
      kind: "values",
      model: true,
      prepare,
      stage,
      inserted: (index: number, stored: Readonly<Record<string, unknown>>): unknown => {
        const entry = entries.get(index);
        if (entry === undefined) return stored;
        commit(entry, stored as Doc);
        return entry.document;
      },
    });
    const plan: InsertPlan = Object.freeze({
      op: "insertMany",
      entity: model.entity as EntityClass,
      documents: Object.freeze(inputs.map(() => PENDING)),
      ordered,
      options: planOptions,
    });
    for (const [index, input] of inputs.entries()) {
      try {
        const document: object = model.new(input as never);
        entries.set(index, { document, state: DocumentStates.of(document), attempted: [], committed: false });
      } catch (error) {
        /* Ordered: the failure of the operation at `cast`, nothing prepared and nothing sent. */
        if (ordered || !(error instanceof TypemoError)) {
          throw await model.reportDocumentFailure(plan, write, error, "cast");
        }
        uncast.set(index, error);
      }
    }
    let result: object[];
    try {
      result = (await model.runDocument(plan, write)) as object[];
    } catch (error) {
      /* What the server did store (an unordered insert, or an ordered one up to its first failure) is stored. */
      const ids: Readonly<Record<number, unknown>> = error instanceof BulkWriteError ? error.result.insertedIds : {};
      for (const [index, entry] of entries) {
        if (Object.hasOwn(ids, index)) commit(entry, { _id: ids[index] });
        if (entry.committed) await DocumentHooks.post(entry.attempted, "document.save", (self) => self);
        else {
          if (entry.sent !== undefined) DocumentSave.release(entry.sent);
          await DocumentHooks.failed(entry.attempted, "document.save", entry.rejected ?? error);
        }
      }
      throw error;
    }
    try {
      for (const entry of entries.values()) await DocumentHooks.post(entry.attempted, "document.save", (self) => self);
    } catch (error) {
      throw HookErrors.afterWrite(
        model.modelName,
        "insertMany",
        result,
        error,
        DocumentSave.transactional(undefined, options),
      );
    }
    return result;
  }

  /**
   * Whether the inserts of a `bulkWrite` must go through documents: the model (or one of its discriminators, or a
   * subdocument of theirs) has `document.save` or `document.validate` hooks. Without such hooks the value steps
   * give the same stored document, so the plain path is kept.
   *
   * @param schema - The compiled schema of the model.
   * @returns `true` when an insert fires document hooks.
   */
  static documentHooked(schema: CompiledSchema): boolean {
    return [schema, ...schema.discriminators.values()].some((one) =>
      (["document.save", "document.validate"] as const).some(
        (event) => HookRegistry.has(one, event) || DocumentHooks.embeds(one, event),
      ),
    );
  }

  /**
   * `model.bulkWrite(operations)` when an operation fires hooks of its own: every operation runs the hooks its
   * standalone counterpart runs. An `insertOne` becomes a new document that goes through the preparation of
   * `save` (`pre('save')`, the validation with its `document.validate` hooks, timestamps), as `Model.insertOne`
   * does (only when `documents`); an update, replace or delete runs its `query.<kind>` hooks (`BulkUnits`). The
   * operation keeps its own `model.bulkWrite` event. Post hooks run after the whole bulk succeeded: first
   * `model.bulkWrite`, then per operation in order. When the bulk fails, an operation the server applied (ordered:
   * before the first failure; unordered: without a write error) still ends in its post hooks, and every other one in
   * its postError hooks (with its own failure when it has one).
   *
   * @param model - The model.
   * @param plan - The planned bulk.
   * @param options - Session and policy of the write, as `save` takes them.
   * @param documents - Whether the inserts fire document hooks.
   * @returns The bulk result.
   * @throws {BulkWriteError} When any operation fails.
   * @throws {PostHookError} When a post hook fails after the write succeeded (outside a transaction).
   */
  static async bulkWrite(
    model: Model<object>,
    plan: BulkWritePlan,
    options: SaveOptions,
    documents: boolean,
  ): Promise<BulkWriteSummary> {
    interface Entry {
      readonly document: object;
      readonly state: DocumentState;
      readonly attempted: Attempted;
      sent?: Sent;
      rejected?: TypemoError;
      committed: boolean;
    }
    const schema = ModelInternals.schema(model);
    const ordered = plan.ordered;
    const entries = new Map<number, Entry>();
    const uncast = new Map<number, TypemoError>();
    const stage: { step: StepName } = { step: "validate" };
    const box: { pending?: Promise<readonly BulkWriteModel[]> } = {};
    const units = BulkUnits.needed(schema, plan.operations) ? new BulkUnits(model.modelName, schema) : undefined;
    /* Once per operation, also when an audit transaction runs the operation again. */
    const build = async (): Promise<readonly BulkWriteModel[]> => {
      const operations = [...plan.operations];
      for (const [index, entry] of entries) {
        DocumentSave.enlist(entry.document, options);
        stage.step = "hooksPre";
        await DocumentHooks.pre(entry.state.schema, entry.document, "document.save", entry.attempted);
        stage.step = "validate";
        try {
          const prepared = (await DocumentSave.prepare(entry.document, entry.state, options, "bulkWrite")) as Extract<
            Prepared,
            { kind: "insert" }
          >;
          entry.sent = prepared.sent;
          operations[index] = Object.freeze({ insertOne: Object.freeze({ document: prepared.document }) });
        } catch (error) {
          if (ordered || !(error instanceof TypemoError)) throw error;
          entry.rejected = error;
        }
      }
      return Object.freeze(operations);
    };
    const prepare: DocumentPrepare = async (ctx) => {
      box.pending ??= build();
      const operations = await box.pending;
      ctx.operations = operations;
      units?.base(operations);
      for (const [index, error] of uncast) ctx.reject(index, error);
      for (const [index, entry] of entries) if (entry.rejected !== undefined) ctx.reject(index, entry.rejected);
    };
    const prepared = new Set<number>();
    const write: DocumentWrite = Object.freeze({
      kind: "hooks",
      model: true,
      ...(documents ? { prepare, stage, prepared } : {}),
      ...(units === undefined ? {} : { units }),
    });
    if (documents) {
      for (const [index, operation] of plan.operations.entries()) {
        if (!("insertOne" in operation)) continue;
        try {
          const document: object = model.new(operation.insertOne.document as never);
          entries.set(index, { document, state: DocumentStates.of(document), attempted: [], committed: false });
          prepared.add(index);
        } catch (error) {
          /* Ordered: the failure of the operation at `cast`, nothing prepared and nothing sent. */
          if (ordered || !(error instanceof TypemoError)) {
            throw await model.reportDocumentFailure(plan, write, error, "cast");
          }
          uncast.set(index, error);
        }
      }
    }
    const commit = (entry: Entry, stored: Doc): void => {
      if (entry.committed || entry.sent === undefined) return;
      DocumentSave.commitInsert(entry.document, entry.state, entry.sent, stored);
      entry.committed = true;
    };
    /* The operations with hooks after the write, in order. */
    const hooked = [...new Set([...entries.keys(), ...(units?.hooked(plan.operations) ?? [])])].sort((a, b) => a - b);
    let result: BulkWriteSummary;
    try {
      result = (await model.runDocument(plan, write)) as BulkWriteSummary;
    } catch (error) {
      /* A post hook of the bulk itself failed: everything was written; the documents are stored. */
      const done = error instanceof PostHookError ? (error.result as BulkWriteSummary | undefined) : undefined;
      const summary = done ?? (error instanceof BulkWriteError ? error.result : undefined);
      for (const [index, entry] of entries) {
        if (summary !== undefined && Object.hasOwn(summary.insertedIds, index)) {
          commit(entry, { _id: summary.insertedIds[index] });
        }
      }
      if (done !== undefined) throw error;
      const applied = DocumentSave.appliedOf(error);
      try {
        for (const index of hooked) {
          const entry = entries.get(index);
          const operation = plan.operations[index] as BulkWriteModel;
          if (entry !== undefined) {
            if (entry.committed) await DocumentHooks.post(entry.attempted, "document.save", (self) => self);
            else {
              if (entry.sent !== undefined) DocumentSave.release(entry.sent);
              await DocumentHooks.failed(entry.attempted, "document.save", entry.rejected ?? error);
            }
          } else if (units !== undefined) {
            if (applied(index) && summary !== undefined) {
              await units.post(index, operation, BulkUnits.resultOf(index, operation, summary));
            } else {
              const own =
                error instanceof BulkWriteError
                  ? error.writeErrors.find((failure) => failure.index === index)
                  : undefined;
              await units.failed(index, operation, own?.error ?? error);
            }
          }
        }
      } catch (thrown) {
        throw HookErrors.chain(thrown, error);
      }
      throw error;
    }
    for (const [index, entry] of entries) commit(entry, { _id: result.insertedIds[index] });
    try {
      for (const index of hooked) {
        const entry = entries.get(index);
        const operation = plan.operations[index] as BulkWriteModel;
        if (entry !== undefined) await DocumentHooks.post(entry.attempted, "document.save", (self) => self);
        else await units?.post(index, operation, BulkUnits.resultOf(index, operation, result));
      }
    } catch (error) {
      throw HookErrors.afterWrite(
        model.modelName,
        "bulkWrite",
        result,
        error,
        DocumentSave.transactional(undefined, options),
      );
    }
    return result;
  }

  /**
   * Which operations of a failed bulk the server applied: none for a failure before the request; for a
   * `BulkWriteError`, ordered — those before the first failure, unordered — those without a write error.
   *
   * @param error - The failure of the bulk.
   * @returns Whether the operation at an index was applied.
   */
  private static appliedOf(error: unknown): (index: number) => boolean {
    if (!(error instanceof BulkWriteError)) return () => false;
    const failed = new Set(error.writeErrors.map((failure) => failure.index));
    if (!error.ordered) return (index) => !failed.has(index);
    const first = Math.min(...failed);
    return (index) => index < first;
  }

  /**
   * Building the documents of `create()` failed (a `CastError` of `new Model(doc)`) — the write still is an
   * operation: `operation.start` + `operation.error` at `cast`.
   *
   * @param model - The model `create()` was called on.
   * @param many - Whether several documents were created (a `bulkWrite`), or one (an `insertOne`).
   * @param options - Session, timeout and policy of the write.
   * @param extra - Extra plan options set by the caller.
   * @param error - The failure.
   * @returns The error to throw.
   */
  static failedCreate(
    model: Model<object>,
    many: boolean,
    options: SaveOptions,
    extra: Partial<PlanOptions>,
    error: unknown,
  ): Promise<unknown> {
    return DocumentSave.reportFailed(model, many ? "bulkWrite" : "insertOne", undefined, options, extra, error, "cast");
  }

  /**
   * A bulkSave whose preparation failed (a cast, a validation) is still its `bulkWrite` operation, failed at
   * `validate` (`operation.error`, `wrap`) with nothing sent. The documents are prepared one after another with
   * their hooks, BEFORE the bulk is known (a document with nothing to write adds nothing), so the failure is
   * reported through the operation afterwards. The same holds for a failed `pre('save')` hook of `save` and
   * `bulkSave` (`insertOne`/`updateOne`/`bulkWrite` at `hooksPre`). No steps run and no preparation is faked —
   * `OperationPipeline.reportFailure`; the plan only names the operation and its options for the events.
   *
   * @param model - The model the write runs through.
   * @param op - The operation that failed.
   * @param state - The state of the (first) document, if any.
   * @param options - Session, timeout and policy of the write.
   * @param extra - Extra plan options set by the caller.
   * @param error - The failure.
   * @param step - The pipeline step the failure is reported at.
   * @returns The error as the operation ends with it.
   */
  private static async reportFailed(
    model: Model<object>,
    op: "insertOne" | "updateOne" | "bulkWrite",
    state: DocumentState | undefined,
    options: SaveOptions,
    extra: Partial<PlanOptions>,
    error: unknown,
    step: StepName,
  ): Promise<unknown> {
    const entity = model.entity as EntityClass;
    const planOptions = DocumentSave.options(state, options, extra);
    const plan: ExecutionPlan =
      op === "bulkWrite"
        ? Object.freeze({ op, entity, operations: Object.freeze([]), ordered: true, options: planOptions })
        : op === "insertOne"
          ? Object.freeze({ op, entity, documents: Object.freeze([]), ordered: true, options: planOptions })
          : Object.freeze({
              op,
              entity,
              filter: NOTHING,
              update: NOTHING,
              upsert: false,
              orFail: false,
              options: planOptions,
            });
    return model.reportDocumentFailure(plan, DOCUMENT_VALUES, error, step);
  }

  /**
   * Prepares the write of one document.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param options - Session, timeout and policy of the write.
   * @param method - The method the user called, for error texts.
   * @returns The prepared write, `none` when there is nothing to send.
   */
  private static async prepare(
    document: object,
    state: DocumentState,
    options: SaveOptions,
    method: string,
  ): Promise<Prepared> {
    const begun = DocumentSave.begin(document, state, options);
    return begun.kind === "none" ? begun : DocumentSave.finish(document, state, options, begun, method);
  }

  /**
   * The synchronous part of the preparation: directly assigned values cast, at every depth (a value that cannot
   * be cast is a `CastError`, before any validation; Mongoose H508: cast once); for an existing document the
   * delta and the state to send, in one synchronous step — nothing changed: nothing to write.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param options - Save options.
   * @returns The start of the preparation.
   * @throws {CastError} When a directly assigned value cannot be cast.
   * @throws {UnknownFieldsError} When the save would drop unknown stored fields.
   */
  private static begin(document: object, state: DocumentState, options: SaveOptions): Begun {
    ChangeTracker.castAssigned(document, state);
    if (state.isNew) return { kind: "insert" };
    const delta = Delta.build(document, { dropUnknownFields: options.dropUnknownFields === true });
    if (Delta.isEmpty(delta)) return { kind: "none" };
    /* The state to send, in the same synchronous step as the delta: a change made during the async
       validation is not in this update, so it must stay a change. */
    return { kind: "update", delta, sent: DocumentSave.sent(document, state) };
  }

  /**
   * The asynchronous part (run inside the operation): the validation (with its hooks), the stamps, the insert
   * or the update.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param options - Save options.
   * @param begun - The result of {@link DocumentSave.begin}.
   * @param method - The method the user called, for error texts.
   * @returns The write ready to be sent.
   * @throws {ValidationError} When the document is invalid.
   * @throws {QueryError} When the save needs the version but the document was read without it.
   */
  private static async finish(
    document: object,
    state: DocumentState,
    options: SaveOptions,
    begun: Exclude<Begun, { kind: "none" }>,
    method: string,
  ): Promise<Ready> {
    const doc = document as Doc;
    if (begun.kind === "insert") {
      DocumentSave.stampPolicies(doc, state, options, method);
      await DocumentHooks.validate(state.schema, document, "all", () =>
        DocumentValidation.validate(document, "all", []),
      );
      DocumentSave.stampInsert(doc, state);
      const data = Object.freeze(DocumentSerializer.data(document, state.schema));
      /* The state to send, in the same synchronous step as the data. */
      return { kind: "insert", document: data, sent: DocumentSave.sent(document, state) };
    }
    const { delta, sent } = begun;
    try {
      await DocumentHooks.validate(state.schema, document, delta.modifiedPaths, () =>
        DocumentValidation.validate(document, "modified", delta.modifiedPaths),
      );
      const version = Versioning.plan(state, delta.version, delta.parts);
      const updatedAt = DocumentSave.stampUpdate(doc, state, delta.modifiedPaths);
      const parts: UpdateParts[] = [delta.parts];
      if (updatedAt !== undefined) {
        parts.push({ $set: updatedAt });
        for (const key of Object.keys(updatedAt)) sent.values.set(key, doc[key]);
      }
      const merged = UpdateOps.merge(parts) as Record<string, unknown>;
      const versionKey = Versioning.field(state.schema)?.key;
      const update = version.increment && versionKey !== undefined ? { ...merged, $inc: { [versionKey]: 1 } } : merged;
      return {
        kind: "update",
        filter: DocumentSave.filter(document, state, version.where),
        update: Object.freeze(update),
        versioned: version.where,
        increment: version.increment,
        modifiedPaths: delta.modifiedPaths,
        unknown: delta.unknown,
        sent,
      };
    } catch (error) {
      DocumentSave.release(sent);
      throw error;
    }
  }

  /**
   * The filter of an update: `{ _id, <shard key fields as read>, [version] }` — the ORIGINAL shard key, so a
   * changed one still matches.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param versioned - Whether the version joins the filter.
   * @returns The frozen filter.
   */
  private static filter(document: object, state: DocumentState, versioned: boolean): PlanDocument {
    const doc = document as Doc;
    const filter: Record<string, unknown> = { _id: state.baseline.get("_id") ?? doc._id };
    for (const key of Object.keys(state.schema.options.shardKey ?? {})) {
      if (key === "_id") continue;
      const original = state.baseline.has(key)
        ? state.baseline.get(key)
        : PopulatedFields.stored(document, key, doc[key]);
      if (original !== undefined) filter[key] = Collections.toPlain(original, { maps: "map" });
    }
    const versionKey = Versioning.field(state.schema)?.key;
    if (versioned && versionKey !== undefined) filter[versionKey] = state.version;
    return Object.freeze(filter);
  }

  /**
   * A NEW document gets the operation's tenant (tenant policy) and `deletedAt: null` (soft delete) before it is
   * validated — the pipeline would add them to what is sent, but the document in memory and its validation must
   * see them too. A different tenant already set is refused by the pipeline.
   *
   * @param doc - The document's fields.
   * @param state - Its state.
   * @param options - Save options.
   * @param method - The method the user called, for error texts.
   */
  private static stampPolicies(doc: Doc, state: DocumentState, options: SaveOptions, method: string): void {
    const ambient = PolicyContext.current() ?? PolicyContext.EMPTY;
    const policy =
      options.policy === undefined ? ambient : PolicyContext.merge(ambient, options.policy, `${method}.policy`);
    const tenant = TenantPolicy.forNewDocument(state.schema, policy, `${state.schema.name}.${method}`);
    if (tenant !== undefined && doc[tenant.key] === undefined) DocumentSave.put(doc, state, tenant.key, tenant.value);
    const deleted = SoftDeletePolicy.fieldOf(state.schema);
    if (deleted !== undefined && doc[deleted.key] === undefined) DocumentSave.put(doc, state, deleted.key, null);
  }

  /**
   * New document: `createdAt`/`updatedAt` of one clock, `__v = 0` (the core fills them). A date the caller gave
   * consciously (an import keeps its history) is kept, like any value of a `Defaulted` field.
   *
   * @param doc - The document's fields.
   * @param state - Its state.
   */
  private static stampInsert(doc: Doc, state: DocumentState): void {
    const now = new Date();
    for (const node of state.schema.fields) {
      if ((node.service === "createdAt" || node.service === "updatedAt") && doc[node.key] === undefined)
        DocumentSave.put(doc, state, node.key, new Date(now.getTime()));
      if (node.service === "version" && doc[node.key] === undefined) DocumentSave.put(doc, state, node.key, 0);
    }
  }

  /**
   * Update: `updatedAt = now` (in memory and in the update), on every save that sends something — the server's
   * view of "changed" is not known before the write. A save that assigns `updatedAt` itself keeps that value.
   *
   * @param doc - The document's fields.
   * @param state - Its state.
   * @param modified - The code paths the save changes.
   * @returns The `$set` entry for `updatedAt`; `undefined` without `Timestamped` or when the save writes it.
   */
  private static stampUpdate(
    doc: Doc,
    state: DocumentState,
    modified: readonly string[],
  ): Record<string, unknown> | undefined {
    const node = state.schema.fields.find((field) => field.service === "updatedAt");
    if (node === undefined || modified.includes(node.key)) return undefined;
    const now = new Date();
    DocumentSave.put(doc, state, node.key, now);
    return { [node.key]: new Date(now.getTime()) };
  }

  /**
   * Sets a core-maintained field on the document and remembers it as cast.
   *
   * @param doc - The document's fields.
   * @param state - Its state.
   * @param key - The field key.
   * @param value - The value.
   */
  private static put(doc: Doc, state: DocumentState, key: string, value: unknown): void {
    Object.defineProperty(doc, key, { value, enumerable: true, writable: true, configurable: true });
    DocumentStates.castOf(state).set(key, value);
  }

  /**
   * The state a write sends, taken in the same synchronous step as its update (Mongoose H500): the own field
   * values (the baseline after success), the forced paths, and the journals of the tracked values
   * (`Collections.mark`: changes made from now on go to fresh journals).
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @returns The state being sent.
   */
  private static sent(document: object, state: DocumentState): Sent {
    const doc = document as Doc;
    const values = new Map<string, unknown>();
    const marks = new Map<string, CommitMark>();
    for (const node of state.schema.fields) {
      if (!Object.hasOwn(doc, node.key) || doc[node.key] === undefined) continue;
      /* A populated field: its stored ids are what the write sends and the next baseline. */
      const value = PopulatedFields.stored(document, node.key, doc[node.key]);
      if (value === undefined) continue;
      values.set(node.key, value instanceof Date ? new Date(value.getTime()) : value);
      if (Collections.isTracked(value)) marks.set(node.key, Collections.mark(value));
    }
    return { values, marks, marked: new Set(state.marked ?? []) };
  }

  /**
   * A write that will not be committed: the journals it took go back to their values.
   *
   * @param sent - The state the write took.
   */
  private static release(sent: Sent): void {
    for (const [key, mark] of sent.marks) Collections.unmark(sent.values.get(key), mark);
  }

  /**
   * Commits a successful insert: the document is no longer new and the sent state is the baseline.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param sent - The state the insert sent.
   * @param inserted - The inserted record, carrying the generated `_id`.
   */
  private static commitInsert(document: object, state: DocumentState, sent: Sent, inserted: Doc): void {
    const doc = document as Doc;
    if (doc._id === undefined && inserted._id !== undefined) {
      Object.defineProperty(doc, "_id", { value: inserted._id, enumerable: true, writable: true, configurable: true });
    }
    state.isNew = false;
    const versionKey = Versioning.field(state.schema)?.key;
    if (versionKey !== undefined) state.version = typeof doc[versionKey] === "number" ? (doc[versionKey] as number) : 0;
    DocumentSave.reset(document, state, sent);
  }

  /**
   * Commits a successful update: the version is raised when the update incremented it, and the sent state is
   * the baseline.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param sent - The state the update sent.
   * @param increment - Whether the update incremented the version.
   */
  private static commitUpdate(document: object, state: DocumentState, sent: Sent, increment: boolean): void {
    const versionKey = Versioning.field(state.schema)?.key;
    if (increment && versionKey !== undefined && state.version !== undefined) {
      state.version += 1;
      Object.defineProperty(document, versionKey, {
        value: state.version,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      (sent.values as Map<string, unknown>).set(versionKey, state.version);
      DocumentStates.castOf(state).set(versionKey, state.version);
    }
    DocumentSave.reset(document, state, sent);
  }

  /**
   * The new baseline: the values that were SENT; the journals of the collections emptied.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param sent - The state that was sent.
   */
  private static reset(document: object, state: DocumentState, sent: Sent): void {
    const doc = document as Doc;
    const baseline = FieldBaseline.of(state.plan, sent.values);
    if (doc._id !== undefined && !baseline.has("_id")) baseline.set("_id", doc._id);
    state.baseline = baseline;
    for (const path of sent.marked) state.marked?.delete(path);
    for (const [key, mark] of sent.marks) Collections.commit(sent.values.get(key), mark);
  }

  /**
   * An update matched nothing. With the version in the filter, one read by `_id` (same session) tells a
   * version conflict (the document exists) from a deleted document.
   *
   * @param document - The hydrated document.
   * @param state - Its state.
   * @param prepared - The update that matched nothing.
   * @param options - The plan options of the write (session included).
   * @returns Never: it always throws.
   * @throws {VersionError} When the update was versioned and the document exists.
   * @throws {DocumentNotFoundError} When the document no longer exists.
   */
  private static async notMatched(
    document: object,
    state: DocumentState,
    prepared: Extract<Prepared, { kind: "update" }>,
    options: PlanOptions,
  ): Promise<never> {
    if (prepared.versioned) {
      const model = DocumentSave.model(state);
      const found = await model.existsForDocument((document as Doc)._id, options);
      if (found) throw new VersionError(state.schema.name, state.version ?? 0, prepared.modifiedPaths);
    }
    throw DocumentSave.gone("save", state);
  }

  /**
   * The error of an update of a document that matched nothing: the document is gone (deleted since it was read,
   * or out of the scope of the operation's policies). Not an `orFail` error: nobody asked for one.
   *
   * @param method - The method the user called (`save`, `bulkSave`).
   * @param state - The document's state.
   * @returns The error to throw.
   */
  private static gone(method: string, state: DocumentState): DocumentNotFoundError {
    return new DocumentNotFoundError(
      method,
      state.schema.name,
      `${state.schema.name}.${method}: the document is no longer in the collection (deleted since it was read, or out of the scope of the operation's policies); nothing was written`,
    );
  }

  /**
   * The documents of a bulk whose update did not apply (read back by `_id` with their version).
   *
   * @param model - The model of the bulk.
   * @param updates - The planned updates.
   * @param options - The plan options of the bulk.
   * @returns The documents whose update did not apply.
   */
  private static async unmatched(
    model: Model<object>,
    updates: readonly { readonly document: object; readonly state: DocumentState; readonly prepared: Prepared }[],
    options: PlanOptions,
  ): Promise<Set<object>> {
    const versionKey = Versioning.field(ModelInternals.schema(model))?.key;
    const stored = await model.versionsForDocuments(
      updates.map((entry) => (entry.document as Doc)._id),
      versionKey,
      options,
    );
    const failed = new Set<object>();
    for (const entry of updates) {
      if (entry.prepared.kind !== "update") continue;
      const id = (entry.document as Doc)._id;
      const key = String(id);
      if (!stored.has(key)) {
        failed.add(entry.document);
        continue;
      }
      const version = stored.get(key);
      const expected = entry.prepared.increment ? (entry.state.version ?? 0) + 1 : entry.state.version;
      if (entry.prepared.versioned && versionKey !== undefined && version !== expected) failed.add(entry.document);
    }
    return failed;
  }

  /**
   * Refuses to write a deleted document or one whose save is in flight.
   *
   * @param state - The document's state.
   * @param what - The operation name, for the message.
   * @throws {QueryError} When the document was deleted or is being saved.
   */
  private static checkWritable(state: DocumentState, what: string): void {
    if (state.deleted) throw new QueryError(`${what}: the document of ${state.schema.name} was deleted`);
    if (state.saving) {
      throw new QueryError(
        `${what}: a save of this ${state.schema.name} document is still in flight; await it before the next one`,
      );
    }
  }

  /**
   * The model that writes documents of this schema (a discriminator writes through its own model).
   *
   * @param state - The document's state.
   * @returns The model.
   */
  private static model(state: DocumentState): Model<object> {
    return state.connection.model(state.schema.target as EntityClass<object>);
  }

  /**
   * The plan options: the save's session, else the document's, else the ambient transaction's.
   *
   * @param state - The document's state, if any.
   * @param options - Save options.
   * @param extra - Extra plan options set by the caller.
   * @returns The frozen plan options.
   */
  private static options(
    state: DocumentState | undefined,
    options: SaveOptions,
    extra: Partial<PlanOptions>,
  ): PlanOptions {
    const session: ClientSession | null | undefined = options.session !== undefined ? options.session : state?.session;
    const captured = extra.policy ?? PolicyContext.current();
    const policy =
      options.policy === undefined
        ? captured
        : PolicyContext.merge(captured, options.policy, `${extra.method ?? "save"}.policy`);
    return Object.freeze({
      ...extra,
      ...(policy === undefined ? {} : { policy }),
      ...(session === undefined ? {} : { session }),
      ...(options.timeoutMS === undefined ? {} : { timeoutMS: options.timeoutMS }),
    });
  }

  /**
   * Whether a document write runs in a transaction: its session's (the save's, else the document's), else the
   * ambient one; `session: null` opts out.
   *
   * @param state - The document's state, if any.
   * @param options - Save options.
   * @returns `true` inside a transaction.
   */
  private static transactional(state: DocumentState | undefined, options: SaveOptions): boolean {
    const session: ClientSession | null | undefined = options.session !== undefined ? options.session : state?.session;
    if (session === null) return false;
    if (session !== undefined) return session.inTransaction();
    return TransactionContext.current() !== undefined;
  }

  /**
   * Enlists the document in the ambient transaction's current attempt (once), with its snapshot.
   *
   * @param document - The hydrated document.
   * @param options - Save options; `session: null` opts out of the transaction.
   */
  private static enlist(document: object, options: SaveOptions): void {
    if (options.session === null) return;
    const scope = TransactionContext.current();
    if (scope === undefined) return;
    const previous = ENLISTED.get(document);
    if (previous !== undefined && previous.scope === scope && previous.attempt === scope.attempt) return;
    ENLISTED.set(document, { scope, attempt: scope.attempt });
    scope.enlist(DocumentSnapshots.participant(document, DocumentSnapshots.take(document)));
  }
}
