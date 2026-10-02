import { TypemoClient } from "@venloc/typemo";

export const client = await TypemoClient.connect("mongodb://localhost:27017/app");
