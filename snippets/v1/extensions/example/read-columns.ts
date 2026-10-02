import { type SchemaInfo } from "@venloc/typemo";

export type Column = {
  readonly path: string;
  readonly header: string;
  readonly format: (value: unknown) => string;
};

export const columns = (schema: SchemaInfo): Column[] => {
  const out: Column[] = [];
  for (const path of Object.keys(schema.describe().paths)) {
    const ext = schema.extOf(path)?.label as { text: string; format?: (value: never) => string } | undefined;
    if (ext === undefined) continue;
    const format = ext.format as ((value: unknown) => string) | undefined;
    out.push({ path, header: ext.text, format: format ?? String });
  }
  return out;
};
