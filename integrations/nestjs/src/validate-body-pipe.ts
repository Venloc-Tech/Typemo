/*
 * `ValidateBodyPipe`: a request body checked by the entity itself (`Model.validate`: the field types, `required`,
 * the limits, the validators), without a separate DTO class to keep in step with it. An unknown field is a 422 by
 * default (the strictness of the core: a misspelt field is not dropped silently); `dropUnknown` drops it instead.
 * `pick` and `omit` limit what the caller may send; `partial` checks only the fields that were sent (an update).
 */
import {
  type ArgumentMetadata,
  Injectable,
  type PipeTransform,
  type Type,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ConfigurationError,
  type CreateInput,
  type DataKeys,
  type EntityClass,
  type Model,
  ValidationError,
} from "@venloc/typemo";
import { InjectModel } from "./inject.ts";
import type { FeatureTarget } from "./tokens.ts";

/**
 * The options of `ValidateBodyPipe`.
 *
 * @typeParam T - The entity.
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {
 *   @Prop(() => String) title?: string;
 *   @Prop(() => String) role?: string;
 * }
 * const options: ValidateBodyOptions<Account> = { omit: ["role"], partial: true };
 * ```
 */
export interface ValidateBodyOptions<T> {
  /** Only these fields may be sent. */
  readonly pick?: readonly (DataKeys<T> | "_id")[];
  /** These fields may not be sent (a role, an owner the server sets). */
  readonly omit?: readonly (DataKeys<T> | "_id")[];
  /** Check only the fields that were sent; a required field may be missing. Default `false`. */
  readonly partial?: boolean;
  /** Drop the fields the entity does not have (and the ones `pick`/`omit` exclude) instead of a 422. Default `false`. */
  readonly dropUnknown?: boolean;
}

/**
 * The 422 of a body: `{ statusCode, error, message, errors: { path: message } }`.
 *
 * @param errors - The messages by path.
 * @returns The exception.
 */
const invalid = (errors: Readonly<Record<string, string>>): UnprocessableEntityException =>
  new UnprocessableEntityException({
    statusCode: 422,
    error: "Unprocessable Entity",
    message: "Validation failed",
    errors,
  });

/**
 * Validates a request body by the schema of an entity and returns the cast fields that were sent.
 *
 * @typeParam T - The entity.
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {
 *   @Prop(() => String, { required: true }) title!: string;
 * }
 *
 * @Controller("accounts")
 * class AccountsController {
 *   @Post()
 *   create(@Body(ValidateBodyPipe.for(Account)) body: CreateInput<Account>): string {
 *     return body.title;
 *   }
 * }
 * ```
 */
export class ValidateBodyPipe<T extends object> implements PipeTransform<unknown, Promise<CreateInput<T>>> {
  readonly #model: Model<T>;
  readonly #options: ValidateBodyOptions<T>;

  /**
   * @param model - The model whose schema checks the body.
   * @param options - `pick`, `omit`, `partial`, `dropUnknown`.
   * @throws {ConfigurationError} When `model` is not a model or an option is invalid.
   */
  constructor(model: Model<T>, options: ValidateBodyOptions<T> = {}) {
    if (typeof (model as { validate?: unknown } | undefined)?.validate !== "function") {
      throw new ConfigurationError(
        "ValidateBodyPipe: a model (inject it with @InjectModel, or use ValidateBodyPipe.for(Entity))",
      );
    }
    const known = new Set(["pick", "omit", "partial", "dropUnknown"]);
    for (const key of Object.keys(options)) {
      if (!known.has(key)) {
        throw new ConfigurationError(
          `ValidateBodyPipe: unknown option "${key}" (known: pick, omit, partial, dropUnknown)`,
        );
      }
    }
    if (options.pick !== undefined && options.omit !== undefined) {
      throw new ConfigurationError("ValidateBodyPipe: give pick or omit, not both");
    }
    this.#model = model;
    this.#options = options;
  }

  /**
   * A pipe class for the model of an entity registered with `forFeature`.
   *
   * @param entity - The entity.
   * @param options - `pick`, `omit`, `partial`, `dropUnknown`.
   * @param target - The client and database of its `forFeature`.
   * @returns The pipe class, for `@Body(ValidateBodyPipe.for(Entity, options))`.
   */
  static for<T extends object>(
    entity: EntityClass<T>,
    options: ValidateBodyOptions<T> = {},
    target?: FeatureTarget,
  ): Type<ValidateBodyPipe<T>> {
    @Injectable()
    class EntityValidateBodyPipe extends ValidateBodyPipe<T> {
      constructor(@InjectModel(entity, target) model: Model<T>) {
        super(model, options);
      }
    }
    Object.defineProperty(EntityValidateBodyPipe, "name", { value: `ValidateBodyPipe(${entity.name})` });
    return EntityValidateBodyPipe;
  }

  /**
   * The top-level fields an update may not set: `_id`, the immutable fields, the fields the core maintains.
   *
   * @param model - The model.
   * @returns Their names.
   */
  static fixedFields(model: { readonly schema: Model<object>["schema"] }): Set<string> {
    const fixed = new Set<string>();
    for (const [path, description] of Object.entries(model.schema.describe().paths)) {
      const flags = description.flags?.split(",") ?? [];
      if (!path.includes(".") && flags.some((flag) => flag === "immutable" || flag.startsWith("service:")))
        fixed.add(path);
    }
    return fixed;
  }

  /**
   * Validates the body.
   *
   * @param value - The body.
   * @param _metadata - Unused.
   * @returns The cast fields that were sent (no defaults: `create` applies them).
   * @throws UnprocessableEntityException - 422 with every failing field.
   */
  async transform(value: unknown, _metadata?: ArgumentMetadata<unknown>): Promise<CreateInput<T>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw invalid({ "": "expected an object" });
    }
    const { pick, omit, partial = false, dropUnknown = false } = this.#options;
    const allowed = (key: string): boolean =>
      (pick === undefined || pick.includes(key as never)) && (omit === undefined || !omit.includes(key as never));
    // An update cannot change `_id`, an immutable field or a field the core maintains (timestamps).
    const fixed = partial ? ValidateBodyPipe.fixedFields(this.#model) : new Set<string>();
    const input: Record<string, unknown> = {};
    const refused: Record<string, string> = {};
    for (const [key, field] of Object.entries(value)) {
      if (fixed.has(key)) {
        if (!dropUnknown) refused[key] = "cannot be changed";
      } else if (allowed(key)) input[key] = field;
      else if (!dropUnknown) refused[key] = "not allowed here";
    }
    let cast: Readonly<Record<string, unknown>> | undefined;
    const errors: Record<string, string> = { ...refused };
    try {
      cast = (await this.#model.validate(input)) as Readonly<Record<string, unknown>>;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      for (const issue of error.issues) {
        const root = String(issue.path[0] ?? "");
        if (partial && issue.reason === "required" && !(root in input)) continue;
        if (dropUnknown && issue.reason === "unknown-key" && issue.path.length === 1) {
          delete input[root];
          continue;
        }
        errors[issue.path.join(".")] ??= issue.message;
      }
      if (Object.keys(errors).length === 0) {
        // Only dropped fields and (partial) missing ones failed: cast what is left, field by field.
        cast = this.#model.castObject(input) as Readonly<Record<string, unknown>>;
      }
    }
    if (Object.keys(errors).length > 0 || cast === undefined) throw invalid(errors);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input)) if (key in cast) result[key] = cast[key];
    return result as CreateInput<T>;
  }
}
