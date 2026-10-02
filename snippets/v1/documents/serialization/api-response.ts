import { type Computed, Entity, type Hidden, Mask, Prop, Schema, Spec, TypemoClient, Versioned } from "@venloc/typemo";
@Schema({ collection: "invoices" })
class Invoice extends Versioned(Entity) {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Date) issuedAt?: Date;
  @Prop(() => BigInt) points?: bigint;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Spec.map(Number)) fees?: Map<string, number>;
  @Prop(() => String, { hidden: true }) note?: Hidden<string>;
  @Prop(() => Number, { get: (value: number) => Math.round(value) }) discount?: number;
  get label(): Computed<string> {
    return `${this.customer}#${this.tags.length}` as Computed<string>;
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Invoices = client.db().model(Invoice);
const invoice = await Invoices.findOne({ customer: "alice" }).orFail();
// ---cut---
const plain = invoice.$toPlain();
//    ^?
console.log(typeof plain._id, plain.points, plain.issuedAt instanceof Date, plain.fees instanceof Map);
// → "string" "9007199254740993" true true
