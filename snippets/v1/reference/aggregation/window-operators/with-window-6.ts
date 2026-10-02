export const withWindow: <V, K extends ExprKind, const W extends WindowSpec>(
  expr: ExprNode<V, K> & ("bounded" extends K ? unknown : { readonly error: "…" }),
  window: W,
) => ExprNode<V, WindowedKind<K, W>>;
