import { HOOK_EVENTS } from "@venloc/typemo";
// ---cut---
console.log(HOOK_EVENTS.length, HOOK_EVENTS.filter((event) => event.startsWith("document.")));
// → 21 ["document.save", "document.validate", "document.init", "document.updateOne", "document.deleteOne"]
