import { ConfigurationError } from "../errors/configuration-error.ts";
import type { OperationEnvironment } from "../operation/pipeline/operation-context.ts";
import type { OperationPipeline } from "../operation/pipeline/operation-pipeline.ts";
import type { CompileContext } from "../schema/compiler/schema-compiler.ts";
import type { Connection } from "./connection.ts";

/*
 * Replacing pipeline slots could drop the `policies` slot (tenant, soft delete, Hidden, sanitize, strict),
 * and no setting may loosen those policies. The pipeline of a connection is therefore reachable only through
 * this class, which is exported from `src/internal.ts` (tests of single steps, perf guards) and never from
 * the public entry `src/index.ts`. `Connection` installs the accessors from a static block, so the pipeline
 * stays in a `#private` field.
 */

/**
 * How `Connection` exposes its pipeline to the core (installed once by `Connection`).
 *
 * @example
 * ```ts
 * ConnectionInternals.install({
 *   get: (connection) => connection.#pipeline,
 *   environment: (connection) => connection.#environment,
 *   compileContext: (connection) => connection.#compileContext,
 *   set: (connection, pipeline) => { connection.#pipeline = pipeline; },
 * });
 * ```
 */
export interface PipelineAccess {
  /** Reads the operation pipeline of a connection. */
  readonly get: (connection: Connection) => OperationPipeline;
  /** Reads what the operations of a connection's models need. */
  readonly environment: (connection: Connection) => OperationEnvironment;
  /** Reads what the schemas of a connection's models are compiled with. */
  readonly compileContext: (connection: Connection) => CompileContext;
  /** Replaces the operation pipeline of a connection. */
  readonly set: (connection: Connection, pipeline: OperationPipeline) => void;
}

/** Internal access to a connection's operation pipeline. Not part of the public API. */
export class ConnectionInternals {
  static #access: PipelineAccess | undefined;

  /**
   * Installs the accessors. Called once by `Connection`'s static block; later calls are ignored.
   *
   * @param access - The accessors to the connection's private fields.
   */
  static install(access: PipelineAccess): void {
    ConnectionInternals.#access ??= access;
  }

  /**
   * @returns The installed accessors.
   * @throws {ConfigurationError} When `Connection` has not been loaded yet.
   */
  static #required(): PipelineAccess {
    const access = ConnectionInternals.#access;
    if (access === undefined) throw new ConfigurationError("ConnectionInternals: Connection is not loaded");
    return access;
  }

  /**
   * @param connection - The connection.
   * @returns The operation pipeline of the connection's models.
   */
  static pipeline(connection: Connection): OperationPipeline {
    return ConnectionInternals.#required().get(connection);
  }

  /**
   * @param connection - The connection.
   * @returns What the operations of the connection's models need (driver `Db`, hub, readiness). Not public,
   *   because it hands out the raw driver.
   */
  static environment(connection: Connection): OperationEnvironment {
    return ConnectionInternals.#required().environment(connection);
  }

  /**
   * @param connection - The connection.
   * @returns What the schemas of the connection's models are compiled with (its plugins and the client's
   *   extensions).
   */
  static compileContext(connection: Connection): CompileContext {
    return ConnectionInternals.#required().compileContext(connection);
  }

  /**
   * Replaces the pipeline (tests of single steps). Models created earlier and later both use it.
   *
   * @param connection - The connection.
   * @param pipeline - The pipeline to use from now on.
   */
  static usePipeline(connection: Connection, pipeline: OperationPipeline): void {
    ConnectionInternals.#required().set(connection, pipeline);
  }
}
