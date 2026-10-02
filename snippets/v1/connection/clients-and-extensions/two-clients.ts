import { TypemoClient } from "@venloc/typemo";

export const main = await TypemoClient.connect("mongodb://localhost:27017/app", { name: "main" });
export const reports = await TypemoClient.connect("mongodb://reports.example.test:27017/reports", {
  name: "reports",
  timeoutMS: 60_000,
});
