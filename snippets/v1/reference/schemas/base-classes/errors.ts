import { EntityWithId } from "@venloc/typemo";
// ---cut---
// @errors: 2322
class Flagged extends EntityWithId(() => Boolean) {}
