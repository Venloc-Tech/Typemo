import { type SchemaPlugin } from "@venloc/typemo";
// ---cut---
export const inspect: SchemaPlugin = {
  name: "inspect",
  apply: (builder) => {
    console.log(builder.target.name, builder.fieldKeys);
    // → Account [ "_id", "title" ]
  },
};
