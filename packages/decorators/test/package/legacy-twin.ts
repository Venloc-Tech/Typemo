/*
 * Legacy twin of `fixtures.ts`, run by `package.test.ts` as `bun legacy-twin.ts` with cwd packages/typemo
 * (Bun takes the decorator mode from the tsconfig of the cwd). Prints `describe()` of the compiled model.
 */
import { Entity, Index, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";

/** A nested address. */
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true, trim: true }) city!: string;
  @Prop(() => String) zip?: string;
}

/** A user with a unique compound index and a pre-save hook. */
@Schema({ collection: "tc39_pkg_users" })
@Index({ name: 1, age: -1 }, { unique: true })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true }) name!: string;
  @Prop(() => Number, { min: 0 }) age?: number;
  @Prop(() => [String]) tags?: string[];
  @Prop(() => Address) address?: Address;
  @Prop(() => String, { sensitive: "hide" }) secret?: string;

  /** Appends a `saved` tag before every save. */
  @Pre("document.save")
  touch(this: User): void {
    this.tags = [...(this.tags ?? []), "saved"];
  }
}

const client = new TypemoClient("mongodb://127.0.0.1:1", { dbName: "twin" });
const models = [client.connection.model(User)];
process.stdout.write(JSON.stringify(models.map((model) => model.schema.describe())));
await client.close();
