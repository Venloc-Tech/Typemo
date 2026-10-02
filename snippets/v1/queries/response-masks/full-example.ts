import { Entity, Mask, Prop, Schema, Spec, TypemoClient } from "@venloc/typemo";

@Schema()
class Card {
  @Prop(() => String, { required: true })
  number!: string;

  @Prop(() => String)
  holder?: string;
}

@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => String, { nullable: true })
  phone!: string | null;

  @Prop(() => Number)
  age?: number;

  @Prop(() => [Card])
  cards!: Card[];

  @Prop(() => Spec.map(String))
  notes?: Map<string, string>;
}

// your code: the error at the application boundary
class __NotFound__ extends Error {}

export const createSupportService = (client: TypemoClient) => {
  const Customers = client.db().model(Customer);

  // list: contacts and age are shown partly
  const list = () =>
    Customers.find()
      .sort({ name: 1 })
      .plain()
      .mask({ email: Mask.email(), phone: Mask.phone(), age: Mask.bucket([18, 35, 60]) });

  // customer card: card numbers hidden, notes closed entirely
  const card = async (name: string) => {
    const [customer] = await Customers.find({ name })
      .plain()
      .mask({ "cards.number": Mask.card(), "notes.$*": "mask" });
    if (customer === undefined) throw new __NotFound__(`customer ${name} is missing`);
    return customer;
  };

  // the document is already loaded: a masked copy for the response, the original untouched
  const forResponse = async (name: string) => {
    const customer = await Customers.findOne({ name }).orFail();
    return customer.$toJSON({ mask: { email: Mask.email(), "cards.number": Mask.card() } });
  };

  return { list, card, forResponse };
};
