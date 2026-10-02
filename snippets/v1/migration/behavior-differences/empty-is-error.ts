await MPost.updateOne({ title: "a" }, {});
// → { acknowledged: false } — nothing done

await MPost.updateOne({ title: "a" }, { views: 10 });
// wrapped in $set, document changed

await MPost.deleteMany({});
// every document of the collection deleted

await MPost.deleteOne({});
// the first matching document deleted
