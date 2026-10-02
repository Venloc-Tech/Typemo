import { Entity, type Hidden, Mask, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users", audit: true })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;

  // hash: not read by default, "?" in logs
  @Prop(() => String, { hidden: true })
  passwordHash?: Hidden<string>;

  // email: logs keep the start and the domain
  @Prop(() => String, { sensitive: Mask.email() })
  email?: string;

  // token: "[hidden]" in logs and errors
  @Prop(() => String, { sensitive: "hide" })
  resetToken?: string;
}

// your code: the error at the application boundary and the password check
class __Unauthorized__ extends Error {}
const __verifyPassword__ = (password: string, hash: string | undefined): boolean => hash === `hash:${password}`;

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);

// sign-up: the hash is written like an ordinary field
export const signUp = async (name: string, email: string, password: string) =>
  Users.create({ name, email, passwordHash: `hash:${password}` });

// sign-in: the hash is read explicitly and only here
export const signIn = async (name: string, password: string) => {
  const user = await Users.findOne({ name }).select({ "+passwordHash": true }).lean();
  if (user === null || !__verifyPassword__(password, user.passwordHash)) throw new __Unauthorized__();
  return user._id;
};

// profile for the client: no hash in the type or in the data
export const profile = async (name: string) => Users.findOne({ name }).plain().orFail();
