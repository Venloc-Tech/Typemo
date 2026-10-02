import { type ChangeEvent, Entity, type Hidden, Mask, Prop, Schema, TypemoClient } from "@venloc/typemo";

// customers/customer.ts
@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => String, { nullable: true })
  phone!: string | null;

  @Prop(() => String, { hidden: true })
  passwordHash?: Hidden<string>;
}

// cache/ttl-cache.ts: stands in for an external cache (string keys, string values, a lifetime)
export class TtlCache {
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

export const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Customers = client.db().model(Customer);
export const cache = new TtlCache(60_000);

// the handler: the cache holds the masked plain view, never a document
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

// after your own write in this process: drop the entry at once
export const renameCustomer = async (id: string, name: string) => {
  await Customers.updateOne({ _id: id }, { $set: { name } }).orFail();
  cache.delete(id.toLowerCase());
};

// changes from other processes: the change stream drops the entry
export const invalidateOnChange = async (signal: AbortSignal): Promise<void> => {
  const stream = await Customers.watch((pipeline) =>
    pipeline.match({ operationType: { $in: ["update", "replace", "delete"] } }),
  );
  signal.addEventListener("abort", () => void stream.close());
  const forget = (event: ChangeEvent<Customer>): void => {
    if ("documentKey" in event) cache.delete(String(event.documentKey._id));
  };
  for await (const event of stream) forget(event);
};
