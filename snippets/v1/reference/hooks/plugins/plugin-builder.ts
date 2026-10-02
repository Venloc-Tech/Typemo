import { type SchemaPlugin } from "@venloc/typemo";
// ---cut---
export const slugged: SchemaPlugin = {
  name: "slugged",
  apply: (builder) => {
    console.log(builder.target.name, builder.fieldKeys);
    // → Product [ "_id", "title" ]
    builder.addField("slug", () => String);
    builder.addIndex({ slug: 1 });
  },
};
