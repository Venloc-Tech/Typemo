type UpdateInput<T> = {
  -readonly [K in keyof T as K extends Exclude<WritableKeys<T>, "_id"> ? K : never]?: InputOf<NoUndefined<T[K]>>;
} & {};
