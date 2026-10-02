// ---cut---
export const convert = (minor: bigint, rate: string): bigint => {
  const [whole = "0", fraction = ""] = rate.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction);
  return (minor * numerator * 2n + scale) / (scale * 2n);
};
// convert(10000n, "92.5031") → 925031n (minor units: 100.00 × 92.5031 = 9250.31)
