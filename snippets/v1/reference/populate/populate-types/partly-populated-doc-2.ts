export type PartlyPopulatedDoc<T, P extends string> = AnyPopulationFields<T, P> & AnyPopulationMethods;
