const post = await MPost.create({ title: "Hello", views: "42" });
console.log(post.views);
// → 42
