import { Discriminator, Entity, Schema } from "@venloc/typemo";
// ---cut---
// @errors: 1238
@Schema()
class Payment extends Entity {}

@Discriminator("card") // wrong: no key declared
class CardPayment extends Payment {}
