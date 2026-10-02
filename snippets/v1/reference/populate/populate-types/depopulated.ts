export type Depopulated<T, K extends PropertyKey> = { [P in keyof T]: P extends K ? Unboxed<T[P], 4> : T[P] };
