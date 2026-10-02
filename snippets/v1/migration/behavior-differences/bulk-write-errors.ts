const saved = await MPost.insertMany(
  [{ title: "e" }, { views: 5 }, { title: "f" }],
  { ordered: false },
);
// saved.length → 2, the promise resolved, no errors
