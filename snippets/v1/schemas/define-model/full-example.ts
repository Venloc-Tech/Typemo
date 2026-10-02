import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// model: a class with @Schema, the id comes from Entity
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true })
  login!: string;

  @Prop(() => String)
  bio?: string;

  @Prop(() => Date)
  birthday?: Date;
}

// your code: the error at the application boundary
class __BadRequest__ extends Error {}

// sign-up: the model is taken where it is needed
export const registerUser = async (login: string, bio?: string) => {
  const Users = client.connection.model(User);
  try {
    return await Users.create({ login, ...(bio === undefined ? {} : { bio }) });
  } catch (error) {
    throw new __BadRequest__((error as Error).message);
  }
};

const user = await registerUser("ann", "hello");
console.log(user.$toPlain().login);
// → ann
