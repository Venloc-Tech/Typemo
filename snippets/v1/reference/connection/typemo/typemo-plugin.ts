import { Typemo } from "@venloc/typemo";
// ---cut---
Typemo.plugin({
  name: "log-compiled-models",
  apply: (builder) => {
    console.log("схема", builder.target.name);
  },
});
