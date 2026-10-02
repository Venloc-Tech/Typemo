type SubscriberSensitive =
  | "mask"
  | "show"
  | "hide"
  | { readonly mask: (value: unknown, context: { readonly path: string }) => SensitiveJson };
