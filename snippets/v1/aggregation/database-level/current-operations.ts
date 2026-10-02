import { Pipeline, TypemoClient } from "@venloc/typemo";

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
export const activeOperations = async () => {
  const plan = Pipeline.admin()
    .currentOp({ idleConnections: false, allUsers: true })
    .match({ active: true })
    .project({ type: 1, op: 1, ns: 1, _id: 0 })
    .plan();
  return client.aggregate(plan).timeoutMS(5_000);
};
