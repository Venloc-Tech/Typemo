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
// ---cut---
export const getCustomerCard = async (id: string) => {
  const key = id.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return JSON.parse(cached) as { _id: string; name: string; email: string; phone: string };

  const card = await Customers.findById(id)
    .orFail()
    .plain()
    .mask({ email: Mask.email(), phone: Mask.phone() });
  cache.set(key, JSON.stringify(card));
  return card;
};
