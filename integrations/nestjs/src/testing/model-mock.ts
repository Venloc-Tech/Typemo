/*
 * Mocks of models and clients for the unit tests of services, without a database. A mock keeps the names and the
 * parameters of the members it replaces (a wrong name or argument list is a compile error) and may return anything;
 * a member it does not give is `undefined`, so a call to one that was forgotten fails loudly.
 */
import type { Type } from "@nestjs/common";
import type { EntityClass, Model, TypemoClient } from "@venloc/typemo";
import { type FeatureTarget, getClientToken, getModelToken } from "../tokens.ts";
import { TransactionalBinder } from "../transactional-binder.ts";

/**
 * The members of an object that a mock may give: each method with its own parameters and any result.
 *
 * @typeParam M - The mocked type (`Model<Account>`, `TypedView<OpenAccount>`, `TypemoClient`).
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {}
 * const mock: ModelMock<Model<Account>> = { countDocuments: async () => 3 };
 * ```
 */
export type ModelMock<M> = {
  readonly [K in keyof M]?: M[K] extends (...args: infer A) => unknown ? (...args: A) => unknown : M[K];
};

/**
 * A provider of a mock: the token and the value (a `ValueProvider` of Nest).
 *
 * @example
 * ```ts
 * const provider: MockProvider = { provide: "TypemoClient:default", useValue: {} };
 * ```
 */
export interface MockProvider {
  /** The token. */
  provide: string | symbol;
  /** The mock. */
  useValue: unknown;
}

/**
 * A provider that stands for the model of an entity (`@InjectModel(Entity, target)`).
 *
 * @typeParam E - The entity class.
 * @typeParam M - The mocked type; default `Model` of the entity (give `TypedView<V>` for a view).
 * @param entity - The entity.
 * @param mock - The members to replace.
 * @param target - The client and database the real model would be registered on.
 * @returns The provider.
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {}
 * const provider = provideModelMock(Account, { countDocuments: async () => 3 });
 * ```
 */
export const provideModelMock = <E extends EntityClass, M = Model<InstanceType<E>>>(
  entity: E,
  mock: ModelMock<NoInfer<M>>,
  target?: FeatureTarget,
): MockProvider => ({ provide: getModelToken(entity, target), useValue: mock });

/**
 * A provider that stands for a client (`@InjectClient(name)`), and the binder of `@Transactional()` methods: by
 * default `transaction(fn)` calls `fn` at once and returns its result, so a service with transactions is tested
 * without a replica set.
 *
 * @param mock - The members to replace; `transaction` has a default.
 * @param name - The client name; default `"default"`.
 * @returns The providers, to spread into `providers`.
 * @example
 * ```ts
 * const providers = provideClientMock({ transaction: async (fn) => fn(undefined as never) });
 * ```
 */
export const provideClientMock = (
  mock: ModelMock<TypemoClient> = {},
  name?: string,
): (MockProvider | Type<TransactionalBinder>)[] => {
  const client: ModelMock<TypemoClient> = {
    transaction: async (fn: (scope: never) => Promise<unknown>) => fn(undefined as never),
    ...mock,
  };
  return [{ provide: getClientToken(name), useValue: client }, TransactionalBinder];
};
