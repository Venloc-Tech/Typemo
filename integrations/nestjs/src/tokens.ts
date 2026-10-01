/*
 * The injection tokens of the module. A client and a connection are named by strings (the name is the point: two
 * `forRoot` calls with the same name are the same client). A model is named by its CLASS: two classes called `User`
 * in two modules are two models, so the token is a symbol made once per class and target, never a string built
 * from `Entity.name` (`@nestjs/mongoose` used `"UserModel"`, and the second `User` silently took the first one's
 * slot).
 */
import { ConfigurationError, type EntityClass } from "@venloc/typemo";

/**
 * Where a feature lives: the client (the `name` given to `TypemoModule.forRoot`) and the database of that client.
 *
 * @example
 * ```ts
 * const billing: FeatureTarget = { client: "default", db: "billing" };
 * ```
 */
export interface FeatureTarget {
  /** The client name; default `"default"` (the client of a `forRoot` without `name`). */
  readonly client?: string;
  /** The database; default the client's default database (`dbName`, else the one in the connection string). */
  readonly db?: string;
}

/** The name of the client of a `forRoot` without `name`, as `TypemoClient` names it too. */
export const DEFAULT_CLIENT = "default";

/** The symbols of model tokens, per class and per `client/db` key: made once, so every lookup gets the same one. */
const MODEL_TOKENS = new WeakMap<EntityClass, Map<string, symbol>>();

/**
 * A number per class, in the token descriptions: Nest hashes a dynamic module by the text of its metadata (a symbol
 * by its description), so two classes with the same name must not give the same text, or the second `forFeature`
 * would be taken for the first and its providers dropped.
 */
const CLASS_IDS = new WeakMap<EntityClass, number>();
let nextClassId = 1;

/**
 * Checks a client or database name: a non-empty string without `/` (the separator of the token keys).
 *
 * @param value - The name.
 * @param what - `"client"` or `"db"`, for the message.
 * @param where - The function that received it, for the message.
 * @returns The name.
 * @throws {ConfigurationError} When the name is not a non-empty string or contains `/`.
 */
const checkName = (value: unknown, what: "client" | "db", where: string): string => {
  if (typeof value !== "string" || value.trim() === "" || value.includes("/")) {
    throw new ConfigurationError(
      `${where}: the ${what} name is a non-empty string without "/", got ${typeof value === "string" ? `"${value}"` : String(value)}`,
    );
  }
  return value;
};

/**
 * The client name of a target, checked (`"default"` when absent).
 *
 * @param target - The target.
 * @param where - The caller, for the message.
 * @returns The client name.
 * @throws {ConfigurationError} When the name is invalid.
 */
const clientOf = (target: FeatureTarget | undefined, where: string): string =>
  target?.client === undefined ? DEFAULT_CLIENT : checkName(target.client, "client", where);

/**
 * The `client/db` key of a target (`db` empty for the default database).
 *
 * @param target - The target.
 * @param where - The caller, for the message.
 * @returns The key.
 * @throws {ConfigurationError} When a name is invalid.
 */
const keyOf = (target: FeatureTarget | undefined, where: string): string => {
  const db = target?.db === undefined ? "" : checkName(target.db, "db", where);
  return `${clientOf(target, where)}/${db}`;
};

/**
 * The injection token of a `TypemoClient` (`@InjectClient(name)`).
 *
 * @param name - The client name; default `"default"`.
 * @returns The token: `"TypemoClient:<name>"`.
 * @throws {ConfigurationError} When the name is not a non-empty string or contains `/`.
 * @example
 * ```ts
 * const token = getClientToken("analytics"); // "TypemoClient:analytics"
 * ```
 */
export const getClientToken = (name: string = DEFAULT_CLIENT): string =>
  `TypemoClient:${checkName(name, "client", "getClientToken")}`;

/**
 * The injection token of a `Connection` (`@InjectConnection(target)`): the client's default database, or the
 * database `db` of that client.
 *
 * @param target - The client and the database; default the default database of the `"default"` client.
 * @returns The token: `"TypemoConnection:<client>/"` or `"TypemoConnection:<client>/<db>"`.
 * @throws {ConfigurationError} When a name is not a non-empty string or contains `/`.
 * @example
 * ```ts
 * const token = getConnectionToken({ db: "billing" }); // "TypemoConnection:default/billing"
 * ```
 */
export const getConnectionToken = (target?: FeatureTarget): string =>
  `TypemoConnection:${keyOf(target, "getConnectionToken")}`;

/**
 * The injection token of the model of an entity on a client and database (`@InjectModel(Entity, target)`): a
 * symbol made once per class and target, so the same class on two clients or databases has two tokens and two
 * classes with the same name never share one.
 *
 * @param entity - The `@Schema` class (an entity, a view class or the target class of a materialized result).
 * @param target - The client and the database; default the default database of the `"default"` client.
 * @returns The token.
 * @throws {ConfigurationError} When `entity` is not a class or a name is invalid.
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {}
 * const token = getModelToken(Account, { db: "billing" });
 * ```
 */
export const getModelToken = (entity: EntityClass, target?: FeatureTarget): symbol => {
  if (typeof entity !== "function") {
    throw new ConfigurationError(`getModelToken: an entity class (@Schema), got ${typeof entity}`);
  }
  const key = keyOf(target, "getModelToken");
  let byKey = MODEL_TOKENS.get(entity);
  if (byKey === undefined) {
    byKey = new Map();
    MODEL_TOKENS.set(entity, byKey);
  }
  let token = byKey.get(key);
  if (token === undefined) {
    const [client, db] = key.split("/");
    let id = CLASS_IDS.get(entity);
    if (id === undefined) {
      id = nextClassId++;
      CLASS_IDS.set(entity, id);
    }
    token = Symbol(`TypemoModel:${entity.name}#${id} (client "${client}"${db === "" ? "" : `, db "${db}"`})`);
    byKey.set(key, token);
  }
  return token;
};

/**
 * The token of the per-client registry the feature providers report to (internal: the core module reads it for
 * `sync` and for the checks across modules).
 *
 * @param name - The client name.
 * @returns The token.
 */
export const getRegistryToken = (name: string): string => `TypemoRegistry:${name}`;
