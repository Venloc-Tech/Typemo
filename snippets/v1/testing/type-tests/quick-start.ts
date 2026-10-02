type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>(): void => {};
// ---cut---
assertType<Equal<{ a: number }, { a: number }>>(); // compiles

// @errors: 2344
assertType<Equal<{ a: number }, { a: string }>>();
