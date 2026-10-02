class __BadRequest__ extends Error {}
// ---cut---
export class Money {
  static parse(text: string): bigint {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) throw new __BadRequest__(`"${text}" is not an amount like 12.34`);
    return BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  }

  static format(minor: bigint): string {
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  }
}
