import { TypemoClient } from "@venloc/typemo";

export const client = await TypemoClient.connect("mongodb://localhost:27017/blog", {
  keysetSecret: "__a-secret-of-at-least-32-bytes-long__",
});
