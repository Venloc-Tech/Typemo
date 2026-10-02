type PushSort<E> = true extends IsPlainObject<E> ? { readonly [K in keyof LeanOf<E>]?: 1 | -1 } : 1 | -1;
