import { Entity, Prop, Schema, SyncError, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true, index: true })
  owner!: string;
}

const deploy = async (uri: string) => {
  const client = await TypemoClient.connect(uri, { name: "deploy" });
  try {
    const connection = client.connection;
    connection.model(Account);

    // plan: what will change, writing nothing
    const plan = await connection.syncAll({ dryRun: true });
    console.log("planned changes:", plan.created);

    // apply: on failure syncAll throws SyncError with the full report
    await connection.syncAll();
  } catch (error) {
    if (error instanceof SyncError) {
      for (const failure of error.failures) console.error(failure.kind, failure.name, failure.errors.map((e) => e.message));
    }
    throw error;
  } finally {
    await client.close();
  }
};

await deploy("mongodb://localhost:27017/app");
