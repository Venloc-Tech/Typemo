@Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
posts!: VirtualRef<Post>;
