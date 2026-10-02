await MPost.create({ title: "Hello", views: "42" }); // views: 42
await MPost.updateOne({ title: "Hello" }, { views: 10 }); // wrapped in $set
const post = await MPost.findOneAndUpdate({ title: "Hello" }, { $inc: { views: 1 } });
// post.views → the value before the change
