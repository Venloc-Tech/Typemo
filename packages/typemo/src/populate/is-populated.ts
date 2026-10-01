import type { AnyPopulationOf, PartlyPopulatedDoc, PopulatableKeys } from "../document/any-population-doc.ts";
import { PopulatedFields } from "../document/populated-fields.ts";

/**
 * Tells whether the reference (or populate virtual) at `path` of a document in any population state
 * (`AnyPopulationDoc<T>`) holds its populated value, and narrows the document to `PartlyPopulatedDoc<T, path>`:
 * a single reference reads as `AnyPopulationDoc<M> | null` (`null`: the referenced document is gone), an array as
 * `readonly (AnyPopulationDoc<M> | null)[]` (`null`: `retainNullValues`), a Map as its documents, a virtual as its
 * documents or count. At run time it reads the same population records as `$populated()`: `true` while the field
 * still holds what populate put there.
 *
 * `path` is a top-level key of the document. A plain `HydratedDoc<T>` says its references are ids, so it is not
 * accepted: widen it to `AnyPopulationDoc<T>` first (a function parameter does it), or use `$assertPopulated`.
 *
 * @typeParam D - The document type.
 * @typeParam P - The key to test.
 * @param doc - The document.
 * @param path - The reference or populate virtual to test.
 * @returns `true` when `path` holds its populated value.
 * @example
 * ```ts
 * const authorName = (post: AnyPopulationDoc<Post>): string | undefined =>
 *   isPopulated(post, "author") ? post.author?.name : undefined;
 * declare const id: ObjectId;
 * authorName(await Posts.findById(id).orFail()); // undefined
 * authorName(await Posts.findById(id).populate("author").orFail()); // the author's name
 * ```
 */
export const isPopulated = <D extends object, const P extends PopulatableKeys<AnyPopulationOf<D>[0]>>(
  doc: D,
  path: P,
): doc is Extract<PartlyPopulatedDoc<AnyPopulationOf<D>[0], AnyPopulationOf<D>[1] | P>, D> =>
  PopulatedFields.get(doc, path) !== undefined && (doc as Readonly<Record<string, unknown>>)[path] !== undefined;
