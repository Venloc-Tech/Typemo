import { DocumentNotFoundError } from "@venloc/typemo";
import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
declare class __NotFound__ extends Error {}
// ---cut---
export const getUser = async (name: string) => {
  try {
    return await Users.findOne({ name }).orFail().plain();
  } catch (error) {
    if (error instanceof DocumentNotFoundError) throw new __NotFound__(`${error.model} not found`);
    throw error;
  }
};
