/*
 * An entity with query/model/aggregate hooks, recording the order of events (postError is its own
 * decorator). `HookLog.lines` is reset by the tests.
 */
import { Entity, type OperationHookContext, Post, PostError, Pre, Prop, Schema } from "../../../src/index.ts";

/** The order in which the hooks of `Hooked` ran, and a switch that makes its pre hook fail. */
export class HookLog {
  static lines: string[] = [];
  /** When set, the pre hook of `query.find` throws it. */
  static failPre: Error | undefined;
}

/** An entity hooked on find, updateMany, insertMany and aggregate; `postError` covers find and updateMany. */
@Schema({ collection: "m_hooked" })
export class Hooked extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Pre(["query.find", "query.updateMany", "model.insertMany", "aggregate"])
  before(this: OperationHookContext<Hooked>): void {
    HookLog.lines.push(`pre ${this.event} ${JSON.stringify(this.filter ?? null)}`);
    if (HookLog.failPre !== undefined && this.event === "query.find") throw HookLog.failPre;
  }

  @Post(["query.find", "query.updateMany", "model.insertMany", "aggregate"])
  after(this: OperationHookContext<Hooked>, result: unknown): void {
    const size = Array.isArray(result) ? `[${result.length}]` : typeof result;
    HookLog.lines.push(`post ${this.event} ${size}`);
  }

  @PostError(["query.find", "query.updateMany"])
  failed(this: OperationHookContext<Hooked>, error: unknown): void {
    HookLog.lines.push(`postError ${this.event} ${(error as Error).message}`);
  }
}
