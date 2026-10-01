/*
 * `@Transactional()`: runs a method in `client.transaction(...)`. The decorator cannot reach the dependency container,
 * so it only wraps the method; the application binds its instances to its clients when it starts
 * (`TransactionalBinder`). A call on an object no application bound is an error, not a call outside a transaction.
 */
import "reflect-metadata";
import { ConfigurationError, type TransactionOptions, TransactionScope, type TypemoClient } from "@venloc/typemo";
import { DEFAULT_CLIENT } from "./tokens.ts";

/**
 * The options of `@Transactional()`: the core's transaction options and the client.
 *
 * @example
 * ```ts
 * const options: TransactionalOptions = { client: "billing", timeoutMS: 5_000 };
 * ```
 */
export type TransactionalOptions = TransactionalOwnOptions | TransactionalJoinOptions;

/**
 * `@Transactional()` that opens its own transaction: the client and the core's transaction options.
 *
 * @example
 * ```ts
 * const options: TransactionalOwnOptions = { client: "billing", timeoutMS: 5_000 };
 * ```
 */
export interface TransactionalOwnOptions extends TransactionOptions {
  /** The client that runs the transaction; default `"default"`. */
  readonly client?: string;
  /** Not joining: inside an open transaction of the client the call is the core's nesting error. */
  readonly join?: false;
}

/**
 * `@Transactional({ join: true })`: inside an open transaction of the same client the method runs in it (no commit
 * or abort of its own); outside any transaction it opens its own. The transaction options belong to the transaction
 * that is opened, so a joining method takes none: they could not apply when it joins.
 *
 * @example
 * ```ts
 * const options: TransactionalJoinOptions = { join: true, client: "billing" };
 * ```
 */
export interface TransactionalJoinOptions {
  /** The client whose transaction the method joins or opens; default `"default"`. */
  readonly client?: string;
  /** Join an open transaction of the client instead of failing. */
  readonly join: true;
  /** Not with `join`: give it to the outer transaction. */
  readonly readConcern?: never;
  /** Not with `join`: give it to the outer transaction. */
  readonly writeConcern?: never;
  /** Not with `join`: give it to the outer transaction. */
  readonly timeoutMS?: never;
  /** Not with `join`: give it to the outer transaction. */
  readonly maxCommitTimeMS?: never;
}

/** Finds a client of an application by name. */
type ClientResolver = (name: string) => TypemoClient;

/** The registry of the decorated methods and of the bound objects. */
export class TransactionalMethods {
  /** Prototypes with at least one decorated method. */
  static readonly prototypes = new WeakSet<object>();
  /** Instances (and prototypes of non-singleton classes) bound by an application. */
  static readonly bindings = new WeakMap<object, ClientResolver>();

  /**
   * Whether an object (or a prototype of it) has decorated methods.
   *
   * @param value - An instance.
   * @returns `true` when one of its prototypes has a decorated method.
   */
  static has(value: object): boolean {
    for (let proto: object | null = value; proto !== null; proto = Object.getPrototypeOf(proto)) {
      if (TransactionalMethods.prototypes.has(proto)) return true;
    }
    return false;
  }

  /**
   * The resolver bound to an object: the object's own, else the one of a prototype.
   *
   * @param value - The `this` of the call.
   * @returns The resolver, or `undefined` when nothing is bound.
   */
  static resolverOf(value: object): ClientResolver | undefined {
    for (let proto: object | null = value; proto !== null; proto = Object.getPrototypeOf(proto)) {
      const resolver = TransactionalMethods.bindings.get(proto);
      if (resolver !== undefined) return resolver;
    }
    return undefined;
  }
}

/**
 * Runs the method in a transaction of a client: every Typemo operation inside it (also in the methods it calls)
 * joins the transaction, which commits when the method's promise resolves and aborts when it rejects. The method may
 * run more than once (a transient error retries the transaction), and transactions do not nest: a decorated method
 * called from another one is an error from the core, unless it has `join: true` (then it runs in the open
 * transaction of the same client; inside a transaction of another client that is an error too). Works on the providers and controllers of an application that
 * imports `TypemoModule.forRoot` (or provides `provideClientMock` in a test).
 *
 * @param options - The client (`"default"`) and the transaction options, or `join: true`.
 * @returns A method decorator; the method must return a promise.
 * @throws {ConfigurationError} When `join` comes with transaction options; at the call, when the object belongs to no
 *   such application, the client is unknown, or a joining method runs inside a transaction of another client.
 * @example
 * ```ts
 * @Injectable()
 * class TransfersService {
 *   @Transactional()
 *   async transfer(): Promise<void> {}
 * }
 * ```
 */
export const Transactional =
  (options: TransactionalOptions = {}) =>
  <M extends (...args: never[]) => Promise<unknown>>(
    target: object,
    key: string | symbol,
    descriptor: TypedPropertyDescriptor<M>,
  ): TypedPropertyDescriptor<M> => {
    const original = descriptor.value;
    if (typeof original !== "function") {
      throw new ConfigurationError(`@Transactional(): ${String(key)} is not a method`);
    }
    const {
      client: clientName = DEFAULT_CLIENT,
      join = false,
      ...transaction
    } = options as TransactionalOwnOptions & {
      readonly join?: boolean;
    };
    if (typeof join !== "boolean") {
      throw new ConfigurationError(`@Transactional(): join is true or false, got ${String(join)}`);
    }
    if (join && Object.keys(transaction).length > 0) {
      throw new ConfigurationError(
        `@Transactional({ join: true }): ${Object.keys(transaction).join(", ")} cannot go with join; a joined method runs in the outer transaction, give the options to it`,
      );
    }
    if (typeof target === "function") {
      throw new ConfigurationError(
        `@Transactional(): ${target.name}.${String(key)} is static; decorate an instance method`,
      );
    }
    const owner = target.constructor.name;
    const label = `${owner}.${String(key)}`;
    // A `function` (not an arrow): the decorated method needs the `this` of its call.
    const wrapped = function (this: object, ...args: never[]): Promise<unknown> {
      const resolve = this === undefined || this === null ? undefined : TransactionalMethods.resolverOf(this);
      if (resolve === undefined) {
        return Promise.reject(
          new ConfigurationError(
            `@Transactional(): ${label} was called on an object no Nest application with TypemoModule has registered; it works on the providers and controllers of such an application`,
          ),
        );
      }
      let client: TypemoClient;
      try {
        client = resolve(clientName);
      } catch (error) {
        return Promise.reject(error);
      }
      if (join) {
        const ambient = TransactionScope.current();
        if (ambient !== undefined && ambient.owner !== client) {
          return Promise.reject(
            new ConfigurationError(
              `@Transactional({ join: true }): ${label} was called inside a transaction of another client; it joins only a transaction of client "${clientName}"`,
            ),
          );
        }
        // Inside the open transaction of this client: run in it; an error propagates and aborts the outer one.
        if (ambient !== undefined) return original.apply(this, args);
      }
      return client.transaction(() => original.apply(this, args), transaction);
    };
    Object.defineProperty(wrapped, "name", { value: original.name });
    // Metadata other decorators already put on the method (a route, a guard) moves to the wrapper.
    for (const metaKey of Reflect.getOwnMetadataKeys(original)) {
      Reflect.defineMetadata(metaKey, Reflect.getOwnMetadata(metaKey, original), wrapped);
    }
    TransactionalMethods.prototypes.add(target);
    return { ...descriptor, value: wrapped as unknown as M };
  };
