/*
 * Entities whose hooks record the order of every event (`HookTrace.lines`, reset by the
 * tests) — every query/model/aggregate event, the document events of a root and of its subdocuments at two
 * levels, and a plugin's hooks (which run after the class's).
 */
import {
  Entity,
  HOOK_EVENTS,
  type HookEvent,
  type OperationHookContext,
  type OperationHookEvent,
  Plugin,
  Post,
  PostError,
  Pre,
  Prop,
  Schema,
  type SchemaPlugin,
} from "../../../src/index.ts";

/** The shared trace the hooks write to, and the switches the tests use to make hooks fail or skip. */
export class HookTrace {
  static lines: string[] = [];
  /** `event phase` pairs whose hook throws `HookTrace.failure`. */
  static failAt = new Set<string>();
  static failure = new Error("hook failed");
  /** Results a pre hook gives to `skip` by event. */
  static skips = new Map<string, unknown>();
  /** When set, the post hook calls `skip` (refused: the operation already ran). */
  static skipInPost = false;

  /** Clears the trace and every switch. */
  static reset(): void {
    HookTrace.lines = [];
    HookTrace.failAt = new Set();
    HookTrace.skips = new Map();
    HookTrace.skipInPost = false;
  }

  /**
   * Appends a line to the trace.
   *
   * @param line - the line to record
   * @throws `HookTrace.failure` when the line is in `failAt`
   */
  static record(line: string): void {
    HookTrace.lines.push(line);
    if (HookTrace.failAt.has(line)) throw HookTrace.failure;
  }
}

/* Every event that is not a document event, as the tuple the hook decorators take. */
/* cast: a computed list is a plain array, the decorators take a non-empty tuple; it is non-empty by construction */
const OPERATION_EVENTS = HOOK_EVENTS.filter((event): event is OperationHookEvent => !event.startsWith("document.")) as [
  OperationHookEvent,
  ...OperationHookEvent[],
];

/**
 * Summarizes a hook result for the trace.
 *
 * @param value - the result of an operation
 * @returns `[n]` for an array of n items, `null`, `object`, or the `typeof` of the value
 */
const describe = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.length}]`
    : value === null
      ? "null"
      : typeof value === "object"
        ? "object"
        : typeof value;

/** A plugin whose hooks run after the class's. */
export const tracePlugin: SchemaPlugin = {
  name: "trace",
  apply: (builder) => {
    builder.addHook("pre", ["query.find", "document.save"] as HookEvent[], function (this: unknown) {
      HookTrace.record(`plugin pre ${(this as { event?: string }).event ?? "document.save"}`);
    });
  },
};

/** A subdocument at the second level; its document hooks record into the trace. */
@Schema()
export class Leaf9 {
  @Prop(() => String, { required: true, validate: (value: string) => value !== "bad-leaf" || "bad leaf" })
  name!: string;

  @Pre("document.save") preSave(this: Leaf9): void {
    HookTrace.record(`leaf ${this.name} pre save`);
  }
  @Post("document.save") postSave(this: Leaf9): void {
    HookTrace.record(`leaf ${this.name} post save`);
  }
  @PostError("document.save") errorSave(this: Leaf9): void {
    HookTrace.record(`leaf ${this.name} postError save`);
  }
  @Pre("document.validate") preValidate(this: Leaf9): void {
    HookTrace.record(`leaf ${this.name} pre validate`);
  }
  @Post("document.validate") postValidate(this: Leaf9): void {
    HookTrace.record(`leaf ${this.name} post validate`);
  }
  @PostError("document.validate") errorValidate(this: Leaf9, error: unknown): void {
    HookTrace.record(`leaf ${this.name} postError validate ${(error as Error).message}`);
  }
  @Post("document.init") postInit(this: Leaf9): void {
    HookTrace.record(`leaf ${this.name} init`);
  }
  @Pre("document.deleteOne") preDelete(this: Leaf9): void {
    HookTrace.record(`leaf ${this.name} pre deleteOne`);
  }
}

/** A subdocument at the first level (an entity class used as an embedded document) that holds leaves. */
@Schema()
export class Branch9 extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => [Leaf9]) leaves?: Leaf9[];

  @Pre("document.save") preSave(this: Branch9): void {
    HookTrace.record(`branch ${this.name} pre save`);
  }
  @Post("document.save") postSave(this: Branch9): void {
    HookTrace.record(`branch ${this.name} post save`);
  }
  @Pre("document.validate") preValidate(this: Branch9): void {
    HookTrace.record(`branch ${this.name} pre validate`);
  }
  @Post("document.validate") postValidate(this: Branch9): void {
    HookTrace.record(`branch ${this.name} post validate`);
  }
}

/** The root: operation hooks for every event, document hooks, the plugin, and branches with leaves. */
@Plugin(tracePlugin)
@Schema({ collection: "m9_hooked" })
export class Hooked9 extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) n?: number;
  @Prop(() => [Branch9]) branches?: Branch9[];

  @Pre(OPERATION_EVENTS)
  pre(this: OperationHookContext<Hooked9>): void {
    HookTrace.record(`pre ${this.event}`);
    const skip = HookTrace.skips.get(this.event);
    if (skip !== undefined) this.skip(skip as never);
    this.locals.set("started", this.operation);
  }

  @Post(OPERATION_EVENTS)
  post(this: OperationHookContext<Hooked9>, result: unknown): void {
    HookTrace.record(`post ${this.event} ${describe(result)} ${String(this.locals.get("started"))}`);
    if (HookTrace.skipInPost) this.skip(null as never);
  }

  @PostError(OPERATION_EVENTS)
  postError(this: OperationHookContext<Hooked9>, error: unknown): void {
    HookTrace.record(`postError ${this.event} ${(error as Error).name}`);
  }

  @Pre("document.save") preSave(this: Hooked9): void {
    HookTrace.record(`root pre save`);
  }
  @Post("document.save") postSave(this: Hooked9): void {
    HookTrace.record(`root post save`);
  }
  @PostError("document.save") errorSave(this: Hooked9, error: unknown): void {
    HookTrace.record(`root postError save ${(error as Error).name}`);
  }
  @Pre("document.validate") preValidate(this: Hooked9): void {
    HookTrace.record(`root pre validate`);
  }
  @Post("document.validate") postValidate(this: Hooked9): void {
    HookTrace.record(`root post validate`);
  }
  @PostError("document.validate") errorValidate(this: Hooked9): void {
    HookTrace.record(`root postError validate`);
  }
  @Pre("document.init") preInit(this: Hooked9): void {
    HookTrace.record(`root pre init ${this.name}`);
  }
  @Post("document.init") postInit(this: Hooked9): void {
    HookTrace.record(`root post init ${this.name}`);
  }
  @Pre("document.updateOne") preUpdateOne(this: Hooked9): void {
    HookTrace.record(`root pre updateOne ${this.name}`);
  }
  @Post("document.updateOne") postUpdateOne(this: Hooked9, result: unknown): void {
    HookTrace.record(`root post updateOne ${(result as { modifiedCount: number }).modifiedCount}`);
  }
  @Pre("document.deleteOne") preDeleteOne(this: Hooked9): void {
    HookTrace.record(`root pre deleteOne`);
  }
  @Post("document.deleteOne") postDeleteOne(this: Hooked9): void {
    HookTrace.record(`root post deleteOne`);
  }
}
