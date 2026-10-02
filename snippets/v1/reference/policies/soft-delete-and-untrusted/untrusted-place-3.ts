type UntrustedPlace = "filter" | "update" | "projection";

const untrusted: <const V>(value: V, place?: UntrustedPlace) => V
