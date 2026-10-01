/**
 * Tells whether a value is present: neither `null` nor `undefined`. A type guard for every form a document
 * or a reference takes — hydrated, lean, plain, populated (a populated single reference is `null` when the
 * referenced document is gone) — and for `.filter(isPresent)` over a list with `null` elements.
 *
 * @typeParam T - The type of the value.
 * @param value - The value to test.
 * @returns `true` when the value is neither `null` nor `undefined`.
 * @example
 * ```ts
 * declare const id: ObjectId;
 * const post = await Posts.findById(id).populate("author").orFail();
 * if (isPresent(post.author)) console.log(post.author.name);
 * const authors = [post.author, null].filter(isPresent); // the null elements dropped, the type narrowed
 * ```
 */
export const isPresent = <T>(value: T): value is NonNullable<T> => value !== null && value !== undefined;
