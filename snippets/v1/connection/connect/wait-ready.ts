import { TypemoClient } from "@venloc/typemo";

export const client = new TypemoClient("mongodb://localhost:27017/app", { readyTimeoutMS: 5_000 });

export const start = async () => {
  await client.connect();
};
