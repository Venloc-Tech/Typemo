const post = await MPost.create({ title: "a" });
console.log(post.tags);
// → []
