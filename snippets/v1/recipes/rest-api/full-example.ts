import {
  type AnyPopulationDoc,
  CastError,
  type Defaulted,
  DocumentNotFoundError,
  DuplicateKeyError,
  Entity,
  isPopulated,
  KeysetTokenError,
  Prop,
  QueryError,
  type Ref,
  Schema,
  StrictModeError,
  Timestamped,
  TypemoClient,
  Types,
  ValidationError,
} from "@venloc/typemo";

// http/errors.ts: your own error classes, one per response code
export class __NotFound__ extends Error {}
export class __BadRequest__ extends Error {
  constructor(message: string, readonly issues?: unknown) {
    super(message);
  }
}
export class __Conflict__ extends Error {}

// accounts/account.ts: the models
@Schema({ collection: "employees" })
export class Employee extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema({ collection: "accounts" })
export class Account extends Timestamped(Entity) {
  @Prop(() => String, { required: true, unique: true, minLength: 2 })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => String, { enum: ["open", "frozen"], default: "open" })
  status!: Defaulted<"open" | "frozen">;

  @Prop(() => Types.ObjectId, { ref: () => Employee })
  manager?: Ref<Employee>;
}

// db/client.ts: one client for the whole process
export const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.db().model(Account);

// the only place that turns library errors into your response errors
const toHttpError = (error: unknown): unknown => {
  if (error instanceof DocumentNotFoundError) return new __NotFound__(`${error.model} not found`);
  if (error instanceof ValidationError) return new __BadRequest__("validation failed", error.toJSON().issues);
  if (error instanceof DuplicateKeyError) return new __Conflict__("title is taken");
  if (
    error instanceof CastError ||
    error instanceof StrictModeError ||
    error instanceof KeysetTokenError ||
    error instanceof QueryError
  ) {
    return new __BadRequest__(error.message);
  }
  return error;
};

const guard = async <R>(work: () => Promise<R>): Promise<R> => {
  try {
    return await work();
  } catch (error) {
    throw toHttpError(error);
  }
};

// accounts/accounts.service.ts: the handlers
export const getAccount = (id: string) => guard(async () => Accounts.findById(id).orFail().plain());

// one response builder for an account in any state of population
const toResponse = (account: AnyPopulationDoc<Account>) => ({
  id: String(account._id),
  title: account.title,
  manager: isPopulated(account, "manager") ? (account.manager?.name ?? null) : undefined,
});

export const getAccountView = (id: string, expand?: "manager") =>
  guard(async () => {
    if (expand === "manager") return toResponse(await Accounts.findById(id).populate("manager").orFail());
    return toResponse(await Accounts.findById(id).orFail());
  });

const isStatus = (value: string): value is "open" | "frozen" => value === "open" || value === "frozen";

export const listAccounts = (query: {
  owner?: string | undefined;
  status?: string | undefined;
  limit?: string | undefined;
  after?: string | undefined;
}) =>
  guard(async () => {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new __BadRequest__("limit must be an integer from 1 to 100");
    }
    const status = query.status;
    if (status !== undefined && !isStatus(status)) throw new __BadRequest__("status must be open or frozen");
    const filter = {
      ...(query.owner !== undefined && { owner: query.owner }),
      ...(status !== undefined && { status }),
    };
    const page = await Accounts.keysetPage({ filter, sort: [["createdAt", "desc"]], limit, after: query.after ?? null });
    return { items: page.items.map((account) => account.$toPlain()), next: page.nextCursor };
  });

export const createAccount = (body: { title: string; owner: string }) =>
  guard(async () => (await Accounts.create(body)).$toPlain());

export const updateAccount = (id: string, body: { title?: string; status?: "open" | "frozen" }) =>
  guard(async () => {
    const account = await Accounts.findById(id).orFail();
    if (body.title !== undefined) account.$set("title", body.title);
    if (body.status !== undefined) account.$set("status", body.status);
    await account.$save();
    return account.$toPlain();
  });

export const deleteAccount = (id: string) =>
  guard(async () => {
    await Accounts.deleteOne({ _id: id }).orFail();
  });
