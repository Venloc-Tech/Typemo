type AllDocumentsFilter = { readonly _id: { readonly $exists: true } };

class Filters {
  static all(): AllDocumentsFilter;
  static all<T extends { readonly _id?: unknown }>(): Filter<T>;
}
