import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts", validator: true })
class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 2 })
  title!: string;

  @Prop(() => Number, { min: 0 })
  balance?: number;
}

@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true })
  note!: string;
}

export const start = async (uri: string) => {
  // client and models
  const client = await TypemoClient.connect(uri, { name: "main" });
  const connection = client.connection;
  connection.model(Account);
  const Ledger = connection.model(LedgerEntry);

  // collections with the schema's options; init throws SyncError if something does not match
  await connection.init();

  // log: the right size after startup
  console.log((await Ledger.ensureCollection()).result);
  // → "unchanged"

  return client;
};
