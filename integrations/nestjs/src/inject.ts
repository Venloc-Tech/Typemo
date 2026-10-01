/*
 * The injection decorators: `Inject(token)` with the tokens of this module. The type of the parameter is written by
 * the reader (`Model<Account>`): a parameter decorator cannot see it, so it cannot check it.
 */
import { Inject } from "@nestjs/common";
import type { EntityClass } from "@venloc/typemo";
import { type FeatureTarget, getClientToken, getConnectionToken, getModelToken } from "./tokens.ts";

/**
 * Injects the model of an entity registered with `TypemoModule.forFeature` (the `TypedView` of a view class, the
 * `Materialized` of a materialized result).
 *
 * @param entity - The class.
 * @param target - The client and database it was registered on; default the default database of `"default"`.
 * @returns A parameter or property decorator.
 * @throws {ConfigurationError} When `entity` is not a class or a name is invalid.
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {}
 *
 * @Injectable()
 * class AccountsService {
 *   constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}
 * }
 * ```
 */
export const InjectModel = (entity: EntityClass, target?: FeatureTarget): PropertyDecorator & ParameterDecorator =>
  Inject(getModelToken(entity, target));

/**
 * Injects a `Connection`: the default database of a client, or a database registered with `forFeature(…, { db })`.
 *
 * @param target - The client and the database; default the default database of `"default"`.
 * @returns A parameter or property decorator.
 * @throws {ConfigurationError} When a name is invalid.
 * @example
 * ```ts
 * @Injectable()
 * class ReportsService {
 *   constructor(@InjectConnection() private readonly connection: Connection) {}
 * }
 * ```
 */
export const InjectConnection = (target?: FeatureTarget): PropertyDecorator & ParameterDecorator =>
  Inject(getConnectionToken(target));

/**
 * Injects a `TypemoClient` created by `TypemoModule.forRoot` or `forRootAsync`.
 *
 * @param name - The client name; default `"default"`.
 * @returns A parameter or property decorator.
 * @throws {ConfigurationError} When the name is invalid.
 * @example
 * ```ts
 * @Injectable()
 * class TransfersService {
 *   constructor(@InjectClient() private readonly client: TypemoClient) {}
 * }
 * ```
 */
export const InjectClient = (name?: string): PropertyDecorator & ParameterDecorator => Inject(getClientToken(name));
