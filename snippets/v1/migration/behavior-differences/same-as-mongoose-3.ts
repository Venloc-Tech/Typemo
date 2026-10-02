const Base = mongoose.model("Base", new Schema({ amount: Number }, { discriminatorKey: "kind" }));
const Card = Base.discriminator("Card", new Schema({ last4: String }));
await Card.create({ amount: 1, last4: "1" });
// in the database: { amount: 1, last4: "1", kind: "Card" }
