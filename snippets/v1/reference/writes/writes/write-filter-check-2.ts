type WriteForm = "one" | "many";
type WriteFilterCheck<T, F, Form extends WriteForm> = FilterCheck<T, F> &
  ("$and" extends keyof F
    ? unknown
    : [keyof F] extends [never]
      ? {
          readonly "filter error": `an empty filter would ${Form extends "one"
            ? "change or remove an arbitrary document"
            : "affect every document"}; pass a filter, or Filters.all() to mean every document on purpose`;
        }
      : unknown);
