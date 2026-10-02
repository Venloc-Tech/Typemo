await MPost.create({ title: "d", extra: 1 });
// extra silently dropped

const posts = await MPost.find({ nope: 1 });
// filter sent as is: posts.length → 0
