/*
 * `ParseIdPipe`: a route parameter (always a string) becomes the `_id` of a model, whatever its type: an ObjectId
 * (24 hex characters), a UUID, a string, a number, a long. The core casts strings to ObjectId and UUID itself and
 * refuses `"5"` for a number (no silent coercion), so the pipe parses the digits of a numeric id first, strictly:
 * `"5abc"` and `"1e3"` are refused, not read as 5 or 1000.
 */
import { type ArgumentMetadata, BadRequestException, Injectable, type PipeTransform, type Type } from "@nestjs/common";
import { CastError, ConfigurationError, type EntityClass, type IdOf, type Model } from "@venloc/typemo";
import { InjectModel } from "./inject.ts";
import type { FeatureTarget } from "./tokens.ts";

/** A whole number written in decimal. */
const INTEGER = /^-?(0|[1-9]\d*)$/;
/** A decimal number without exponent. */
const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Parses a route parameter into the `_id` of a model; a malformed id is a 400.
 *
 * @typeParam T - The entity.
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {}
 *
 * @Controller("accounts")
 * class AccountsController {
 *   @Get(":id")
 *   get(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>): string {
 *     return String(id);
 *   }
 * }
 * ```
 */
export class ParseIdPipe<T extends object> implements PipeTransform<unknown, IdOf<T>> {
  readonly #model: Model<T>;

  /**
   * @param model - The model whose `_id` type the parameter has.
   * @throws {ConfigurationError} When `model` is not a model.
   */
  constructor(model: Model<T>) {
    if (typeof (model as { castObject?: unknown } | undefined)?.castObject !== "function") {
      throw new ConfigurationError(
        "ParseIdPipe: a model (inject it with @InjectModel, or use ParseIdPipe.for(Entity))",
      );
    }
    this.#model = model;
  }

  /**
   * A pipe class for the model of an entity registered with `forFeature`: Nest creates it in the module of the
   * controller and injects the model.
   *
   * @param entity - The entity.
   * @param target - The client and database of its `forFeature`.
   * @returns The pipe class, for `@Param("id", ParseIdPipe.for(Entity))`.
   */
  static for<T extends object>(entity: EntityClass<T>, target?: FeatureTarget): Type<ParseIdPipe<T>> {
    @Injectable()
    class EntityParseIdPipe extends ParseIdPipe<T> {
      constructor(@InjectModel(entity, target) model: Model<T>) {
        super(model);
      }
    }
    Object.defineProperty(EntityParseIdPipe, "name", { value: `ParseIdPipe(${entity.name})` });
    return EntityParseIdPipe;
  }

  /**
   * Parses the value.
   *
   * @param value - The parameter.
   * @param metadata - Which parameter it is (for the message).
   * @returns The id.
   * @throws BadRequestException - When the value is not an id of the model.
   */
  transform(value: unknown, metadata?: ArgumentMetadata<unknown>): IdOf<T> {
    const name = metadata?.data === undefined ? "id" : String(metadata.data);
    const type = this.#model.schema.describe().paths._id?.type;
    let input: unknown = value;
    if (typeof value === "string") {
      if (type === "number" || type === "double" || type === "int32") {
        input = DECIMAL.test(value) ? Number(value) : value;
      } else if (type === "long") {
        input = INTEGER.test(value) ? BigInt(value) : value;
      }
    }
    try {
      return (this.#model.castObject({ _id: input }) as unknown as { readonly _id: IdOf<T> })._id;
    } catch (error) {
      if (!(error instanceof CastError)) throw error;
      throw new BadRequestException(`Invalid ${name}: expected ${error.expected} (${error.detail})`, { cause: error });
    }
  }
}
