import { TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
export const serverVersion = async (): Promise<string> => {
  const info = await client.unsafeDriver().db("admin").command({ buildInfo: 1 });
  return String(info.version);
};
