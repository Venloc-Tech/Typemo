type PluginStatics<P> = P extends { readonly statics?: infer S }
  ? { readonly [K in keyof Exclude<S, undefined>]: OmitThisParameter<Exclude<S, undefined>[K]> }
  : never;
