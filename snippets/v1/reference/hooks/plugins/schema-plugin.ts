import { type SchemaPlugin } from "@venloc/typemo";
// ---cut---
export const seenAt: SchemaPlugin<{ readonly field: string }> = {
  name: "seen-at",
  apply: (builder, options) => {
    builder.addField(options.field, () => Date);
  },
};
