export const isPopulated = <D extends object, const P extends PopulatableKeys<AnyPopulationOf<D>[0]>>(
  doc: D,
  path: P,
): doc is Extract<PartlyPopulatedDoc<AnyPopulationOf<D>[0], AnyPopulationOf<D>[1] | P>, D> =>
  PopulatedFields.get(doc, path) !== undefined && (doc as Readonly<Record<string, unknown>>)[path] !== undefined;
