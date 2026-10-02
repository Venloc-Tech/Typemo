hint(hint: Hint<T>): QueryBuilder<T, Op, S, E, Form, Found, N, X>

type Hint<T> = string | { readonly [P in FilterPaths<T>]?: 1 | -1 | "text" | "2dsphere" | "2d" | "hashed" }
