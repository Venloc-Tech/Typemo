import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
const run = async (work: () => Promise<void>): Promise<void> => {
  if (client.currentTransaction() !== undefined) return work();
  return client.transaction(work);
};

console.log(client.currentTransaction());
// → undefined
await client.transaction(async (scope) => {
  console.log(client.currentTransaction() === scope);
  // → true
  await run(async () => {});
});
