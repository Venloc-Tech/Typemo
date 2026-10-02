import { Entity, Prop, Schema, TypemoClient, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
export const handle = async (filter: unknown) => {
  try {
    return await Users.find(filter as { name: string }).plain();
  } catch (error) {
    if (error instanceof StrictModeError) {
      return { status: 400, reason: error.reason, path: error.path };
    }
    throw error;
  }
};
