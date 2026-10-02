{
  type: "query",
  category: "typemo",
  level: "info",
  message: "Typemo.find (Account)",
  data: {
    model: "Account",
    collection: "accounts",
    database: "bank",
    durationMS: 3.14,
    documentCount: 1,
    summary: { filter: { balance: { $gt: "?" } } },
  },
}
