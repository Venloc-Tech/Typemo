import { Discriminator, Entity, Schema } from "@venloc/typemo";
// ---cut---
// @errors: 1238
@Schema()
class Shape extends Entity {}

@Discriminator("circle")
class Circle extends Shape {}
