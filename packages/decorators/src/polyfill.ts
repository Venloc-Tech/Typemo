// E2: TC39 decorator metadata needs `Symbol.metadata`, which Bun 1.4 does not define (prototype 2.3).
// The standard, well-known registry symbol is installed only when absent (`??=`), so an engine or a
// library that already provides it wins; this is the one global write of the package and is standard.
(Symbol as { metadata?: symbol }).metadata ??= Symbol.for("Symbol.metadata");

export {};
