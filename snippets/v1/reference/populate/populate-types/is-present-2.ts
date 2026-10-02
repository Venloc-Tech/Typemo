export const isPresent = <T>(value: T): value is NonNullable<T> => value !== null && value !== undefined;
