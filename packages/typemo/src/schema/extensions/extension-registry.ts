import { BsonGuards } from "../../bson/bson-guards.ts";
import { ConfigurationError } from "../../errors/configuration-error.ts";

/**
 * Field-level extension options (`@Prop({ ext: { … } })`). Empty in the core: an integration adds its own
 * namespaced key by declaration merging, registers a validator with `Typemo.use()`, and READS the frozen value
 * from the compiled schema. An extension is metadata only: it never runs inside an operation and has no handle
 * on policies (tenant, soft delete, strict, sanitize, Hidden, casting, `sensitive`) — changing an operation
 * goes through hooks (`modify`), which pass every policy.
 *
 * `V` is the field value, so an option may be typed by it (`(value: V) => string`). Every declaration must
 * name the parameter `V`.
 *
 * @example
 * ```ts
 * declare module "@venloc/typemo" {
 *   interface PropExtensions<V> {
 *     myIntegration?: { readonly label: (value: V) => string };
 *   }
 * }
 * ```
 */
// biome-ignore lint/correctness/noUnusedVariables: V is for the augmentations of integrations
// biome-ignore lint/suspicious/noEmptyInterface: filled by declaration merging
export interface PropExtensions<V = unknown> {}

/**
 * Schema-level extension options (`@Schema({ ext: { … } })`), filled by declaration merging like
 * {@link PropExtensions}.
 *
 * @example
 * ```ts
 * declare module "@venloc/typemo" {
 *   interface SchemaExtensions {
 *     myIntegration?: { readonly enabled: boolean };
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: filled by declaration merging
export interface SchemaExtensions {}

/**
 * The name of an extension: a key of `PropExtensions` or `SchemaExtensions` (after augmentation).
 *
 * @example
 * ```ts
 * const name: ExtensionName = "myIntegration";
 * ```
 */
export type ExtensionName = (keyof PropExtensions | keyof SchemaExtensions) & string;

/**
 * The field an `ext` value is declared on (what `validateProp` sees).
 *
 * @example
 * ```ts
 * const field: ExtensionFieldInfo = { where: "User.name", path: "name", dbPath: "name", kind: "scalar" };
 * ```
 */
export interface ExtensionFieldInfo {
  /** `Class.field` for messages. */
  readonly where: string;
  /** Code path in its schema (`name.first` for a nested object's field). */
  readonly path: string;
  /** Database path in its schema. */
  readonly dbPath: string;
  /** The kind of the field node (`scalar`, `array`, `map`, `subdocument`, …). */
  readonly kind: string;
}

/**
 * The schema an `ext` value is declared on (what `validateSchema` sees).
 *
 * @example
 * ```ts
 * const schema: ExtensionSchemaInfo = { name: "User", kind: "document", discriminator: undefined };
 * ```
 */
export interface ExtensionSchemaInfo {
  /** The class name. */
  readonly name: string;
  /** Whether the schema is a document or a nested object. */
  readonly kind: "document" | "nested";
  /** The discriminator value when the schema is a discriminator (it shares its root's options). */
  readonly discriminator: string | undefined;
}

/**
 * An extension registered with `Typemo.use()` (every client) or `client.use()` (one client). A validator
 * receives the value as written (typed callers are checked by the compiler; JS callers are not, so the value
 * is `unknown`) and THROWS when it is invalid — the error becomes the `cause` of a `ConfigurationError`. A key
 * used on a field needs `validateProp`, on a schema `validateSchema` (an extension declares where it may be
 * used).
 *
 * @example
 * ```ts
 * const extension: TypemoExtension<"myIntegration"> = {
 *   name: "myIntegration",
 *   validateProp: (value) => {
 *     if (typeof value !== "object") throw new Error("an object is expected");
 *   },
 * };
 * Typemo.use(extension);
 * ```
 */
export interface TypemoExtension<N extends ExtensionName = ExtensionName> {
  /** The extension's name: the key under `ext`. */
  readonly name: N;
  /**
   * Checks the value used on a field; throws when it is invalid.
   *
   * @param value - The value as written.
   * @param field - The field it is declared on.
   */
  readonly validateProp?: (value: unknown, field: ExtensionFieldInfo) => void;
  /**
   * Checks the value used on a schema; throws when it is invalid.
   *
   * @param value - The value as written.
   * @param schema - The schema it is declared on.
   */
  readonly validateSchema?: (value: unknown, schema: ExtensionSchemaInfo) => void;
}

/**
 * The validators of one registered extension.
 *
 * @example
 * ```ts
 * const validators: Validators = { name: "myIntegration", validateProp: undefined, validateSchema: undefined };
 * ```
 */
type Validators = {
  readonly name: string;
  readonly validateProp: ((value: unknown, field: ExtensionFieldInfo) => void) | undefined;
  readonly validateSchema: ((value: unknown, schema: ExtensionSchemaInfo) => void) | undefined;
};

/**
 * A deep copy of plain objects and arrays, frozen; other values (functions, BSON) as they are.
 *
 * @param value - The value to copy.
 * @returns The frozen copy.
 */
const frozen = (value: unknown): unknown => {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (BsonGuards.isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(out, key, { value: frozen(item), enumerable: true });
    }
    return Object.freeze(out);
  }
  return value;
};

/**
 * The registered extensions: one registry PER CLIENT (`client.use()`, on the client's `CompileContext`, like
 * plugins), over the global one (`Typemo.use()`). A client sees its own extensions and the global ones — also
 * those registered globally after the client was created, until its registry is sealed.
 *
 * Registration is closed by the first SUCCESSFUL schema compile (schemas are sealed), by the same rule as the
 * plugins: an extension registered later could not validate the schemas already compiled. A client's registry is
 * sealed by the first model compiled for that client; the global one by the first schema compiled anywhere (any
 * client, or none). A failed compile leaves both open, so the extension the error named can still be registered.
 */
export class ExtensionRegistry {
  /** The registry of `Typemo.use()`, the parent of every client's registry. */
  static readonly global = new ExtensionRegistry("Typemo.use()", undefined);

  /** The extensions registered here, by name. */
  readonly #byName = new Map<string, Validators>();
  /** The registry consulted after this one. */
  readonly #parent: ExtensionRegistry | undefined;
  /** How the registry's owner registers (messages). */
  readonly #call: string;
  /** What sealed the registry, once sealed. */
  #sealedBy: string | undefined;

  /**
   * @param call - How the owner registers extensions, for messages (`client.use()`).
   * @param parent - The registry consulted after this one.
   */
  constructor(call: string, parent: ExtensionRegistry | undefined) {
    this.#call = call;
    this.#parent = parent;
  }

  /**
   * Registers an extension.
   *
   * @param extension - The extension.
   * @throws {ConfigurationError} When the registry is sealed, the extension is malformed, or its name is taken.
   */
  use(extension: TypemoExtension): void {
    const name: unknown = extension?.name;
    if (this.#sealedBy !== undefined) {
      throw new ConfigurationError(
        `extension "${String(name)}": extensions are fixed once a schema is compiled (${this.#sealedBy} was); call ${this.#call} before the first model`,
      );
    }
    if (typeof name !== "string" || name === "" || name.startsWith("$")) {
      throw new ConfigurationError(
        'an extension is an object { name, validateProp?, validateSchema? } with a name not starting with "$"',
      );
    }
    const { validateProp, validateSchema } = extension;
    if (validateProp !== undefined && typeof validateProp !== "function") {
      throw new ConfigurationError(`extension "${name}": validateProp must be a function`);
    }
    if (validateSchema !== undefined && typeof validateSchema !== "function") {
      throw new ConfigurationError(`extension "${name}": validateSchema must be a function`);
    }
    if (validateProp === undefined && validateSchema === undefined) {
      throw new ConfigurationError(`extension "${name}": needs validateProp, validateSchema or both`);
    }
    if (this.#find(name) !== undefined) throw new ConfigurationError(`extension "${name}" is already registered`);
    this.#byName.set(name, Object.freeze({ name, validateProp, validateSchema }));
  }

  /** The names of the registered extensions (the global ones first), in registration order. */
  get names(): readonly string[] {
    return [...(this.#parent?.names ?? []), ...this.#byName.keys()];
  }

  /**
   * Called by the compiler after a successful compile: no more registrations in THIS registry.
   *
   * @param by - What sealed the registry, for messages.
   */
  seal(by: string): void {
    this.#sealedBy ??= by;
  }

  /**
   * Finds an extension here or in a parent registry.
   *
   * @param name - The extension name.
   * @returns Its validators, or `undefined` when it is not registered.
   */
  #find(name: string): Validators | undefined {
    const own = this.#byName.get(name);
    if (own !== undefined || this.#parent === undefined) return own;
    return this.#parent.#find(name);
  }

  /**
   * Checks and freezes the `ext` of a field.
   *
   * @param ext - The `ext` option as written.
   * @param field - The field it is declared on.
   * @returns The frozen copy; `undefined` when there is none.
   * @throws {ConfigurationError} When `ext` is not an object, names an unregistered extension, or a validator
   * rejects the value.
   */
  prop(ext: unknown, field: ExtensionFieldInfo): Readonly<Record<string, unknown>> | undefined {
    return this.#check(ext, field.where, "field", (validators, value) => {
      if (validators.validateProp === undefined) return `extension "${validators.name}" has no field options`;
      validators.validateProp(value, field);
      return undefined;
    });
  }

  /**
   * Checks and freezes the `ext` of a schema.
   *
   * @param ext - The `ext` option as written.
   * @param schema - The schema it is declared on.
   * @returns The frozen copy; `undefined` when there is none.
   * @throws {ConfigurationError} When `ext` is not an object, names an unregistered extension, or a validator
   * rejects the value.
   */
  schema(ext: unknown, schema: ExtensionSchemaInfo): Readonly<Record<string, unknown>> | undefined {
    return this.#check(ext, schema.name, "schema", (validators, value) => {
      if (validators.validateSchema === undefined) return `extension "${validators.name}" has no schema options`;
      validators.validateSchema(value, schema);
      return undefined;
    });
  }

  /**
   * Checks every entry of an `ext` object with the validator of its extension, and freezes it.
   *
   * @param ext - The `ext` option as written.
   * @param where - Where it is declared, for messages.
   * @param level - Whether it is declared on a field or a schema, for messages.
   * @param run - Runs the extension's validator; returns a problem description, or `undefined` when valid.
   * @returns The frozen copy; `undefined` when `ext` is absent.
   * @throws {ConfigurationError} When `ext` is not an object, names an unregistered extension, or a validator
   * rejects the value.
   */
  #check(
    ext: unknown,
    where: string,
    level: "field" | "schema",
    run: (validators: Validators, value: unknown) => string | undefined,
  ): Readonly<Record<string, unknown>> | undefined {
    if (ext === undefined) return undefined;
    if (!BsonGuards.isPlainObject(ext)) {
      throw new ConfigurationError(`${where}: option "ext" is an object { [extension name]: options }`);
    }
    const out = frozen(ext) as Readonly<Record<string, unknown>>;
    for (const [name, value] of Object.entries(out)) {
      const validators = this.#find(name);
      if (validators === undefined) {
        throw new ConfigurationError(
          `${where}: ext "${name}" is not a registered extension; register it before the first model with ` +
            `client.use() (for the models of one client) or Typemo.use() (for every client)`,
        );
      }
      if (value === undefined) continue;
      let problem: string | undefined;
      try {
        problem = run(validators, value);
      } catch (error) {
        throw new ConfigurationError(
          `${where}: ext "${name}" is invalid: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      if (problem !== undefined) throw new ConfigurationError(`${where}: ${problem} (used on a ${level})`);
    }
    return out;
  }
}
