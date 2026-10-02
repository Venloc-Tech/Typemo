import {
  DocumentNotFoundError,
  DuplicateKeyError,
  Entity,
  Prop,
  Schema,
  TypemoClient,
  TypemoError,
  ValidationError,
} from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;
}

declare class __NotFound__ extends Error {}
declare const __respond__: (status: number, body: unknown) => void;
declare const __logError__: (error: unknown) => void;

const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
await client.connection.init();

// service: catches nothing, library errors propagate as is
export const openAccount = (body: unknown) => Accounts.create(body as { title: string; owner: string });
export const getAccount = (title: string) => Accounts.findOne({ title }).orFail();

// application boundary: the one place where errors turn into responses
export const handle = async (run: () => Promise<unknown>): Promise<void> => {
  try {
    __respond__(200, await run());
  } catch (error) {
    if (error instanceof ValidationError) __respond__(422, error.toJSON().issues);
    else if (error instanceof DocumentNotFoundError) __respond__(404, { error: "not-found" });
    else if (error instanceof DuplicateKeyError) __respond__(409, { fields: Object.keys(error.keyPattern ?? {}) });
    else if (error instanceof TypemoError) {
      __logError__(error);
      __respond__(500, { error: "internal" });
    } else throw error;
  }
};
