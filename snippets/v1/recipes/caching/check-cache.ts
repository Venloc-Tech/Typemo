import { type ChangeEvent, type Hidden, Entity, Mask, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String, { nullable: true }) phone!: string | null;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
class TtlCache {
  hits = 0;
  misses = 0;
  readonly #entries = new Map<string, { value: string; expiresAt: number }>();
  constructor(readonly ttlMs: number) {}
  get(key: string): string | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.expiresAt < Date.now()) {
      this.#entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value;
  }
  set(key: string, value: string): void {
    this.#entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
  delete(key: string): void {
    this.#entries.delete(key);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Customers = client.db().model(Customer);
const cache = new TtlCache(60_000);
const getCustomerCard = async (id: string) => ({ name: "" });
const invalidateOnChange = async (signal: AbortSignal): Promise<void> => {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// ---cut---
const alice = await Customers.create({ name: "Alice", email: "alice@gmail.com", phone: null });
const id = alice._id.toString();
const stop = new AbortController();
void invalidateOnChange(stop.signal);
await sleep(1500);

await getCustomerCard(id);
await getCustomerCard(id);
console.log(cache.hits, cache.misses);
// → 1 1

await Customers.updateOne({ _id: alice._id }, { $set: { name: "Alice B" } });
await sleep(1500);
console.log((await getCustomerCard(id)).name, cache.misses);
// → "Alice B" 2
stop.abort();
