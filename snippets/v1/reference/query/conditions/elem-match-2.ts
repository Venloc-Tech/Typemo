equals<const Y extends WhereOperand<V>>(value: Y): WhereBuilder<…, NarrowIn<N, T, P, Y>, X, P, V>
ne<const Y extends WhereOperand<V>>(value: Y): WhereBuilder<…, NarrowNotIn<N, T, P, Y>, X, P, V>
in<const Y extends readonly WhereOperand<V>[]>(values: Y): WhereBuilder<…, NarrowIn<N, T, P, Y[number]>, X, P, V>
nin<const Y extends readonly WhereOperand<V>[]>(values: Y): WhereBuilder<…, NarrowNotIn<N, T, P, Y[number]>, X, P, V>
gt(value: OrderOperand<V>): WhereBuilder<…>
gte(value: OrderOperand<V>): WhereBuilder<…>
lt(value: OrderOperand<V>): WhereBuilder<…>
lte(value: OrderOperand<V>): WhereBuilder<…>
exists(): WhereBuilder<…, NarrowExists<X, P>, P, V>
exists<const B extends boolean>(present: B): WhereBuilder<…>
regex(pattern: StringOperand<V>): WhereBuilder<…>
mod(divisor: ModOperand<V>, remainder: ModOperand<V>): WhereBuilder<…>
size(n: ArrayOperand<V, number>): WhereBuilder<…>
all(values: ArrayOperand<V, readonly CompareOf<ElementOf<NonNullable<V>>>[]>): WhereBuilder<…>
elemMatch(condition: ArrayOperand<V, ElemMatchOperand<ElementOf<NonNullable<V>>>>): WhereBuilder<…>
