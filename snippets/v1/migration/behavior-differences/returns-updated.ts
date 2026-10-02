const before = await MPost.findOneAndUpdate({ title: "a" }, { $inc: { views: 1 } });
// before.views → 1 (the value before)
const after = await MPost.findOneAndUpdate(
  { title: "a" }, { $inc: { views: 1 } }, { new: true },
);
