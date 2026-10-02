interface UpdateDescription {
  readonly updatedFields: Readonly<Record<string, unknown>>;
  readonly removedFields: readonly string[];
  readonly truncatedArrays?: readonly { readonly field: string; readonly newSize: number }[];
  readonly disambiguatedPaths?: Readonly<Record<string, readonly (string | number)[]>>;
}
