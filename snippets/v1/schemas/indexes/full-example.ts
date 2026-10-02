import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Index({ owner: 1, opened: -1 })
@Index({ email: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "email_active" })
@Index({ closedAt: 1 }, { expireAfterSeconds: 60, name: "closed_ttl" })
@Schema({ collection: "accounts" })
class Account extends Entity {
  // number: unique and required
  @Prop(() => String, { required: true, unique: true })
  number!: string;

  // owner: queried often
  @Prop(() => String, { index: true })
  owner?: string;

  @Prop(() => Date) opened?: Date;
  @Prop(() => String) email?: string;
  @Prop(() => Boolean) active?: boolean;
  @Prop(() => Date) closedAt?: Date;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
client.connection.model(Account);

// application start: create the missing indexes
const report = await client.connection.init();
console.log(report.created);
// → ["collection accounts", "index accounts.number_1", "index accounts.owner_1", "index accounts.owner_1_opened_-1", "index accounts.email_active", "index accounts.closed_ttl"]
