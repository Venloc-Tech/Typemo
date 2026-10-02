import { TypemoClient } from "@venloc/typemo";
// ---cut---
// wrong: the client stays open
const leaky = await TypemoClient.connect("mongodb://localhost:27017/app");

// right: closed at the end of the block
{
  await using client = await TypemoClient.connect("mongodb://localhost:27017/app");
}
