import { DocumentNotFoundError } from "@venloc/typemo";
declare class __NotFound__ extends Error {}
declare const load: () => Promise<unknown>;
// ---cut---
try {
  await load();
} catch (error) {
  if (error instanceof DocumentNotFoundError) throw new __NotFound__(`${error.model} not found`);
  throw error;
}
