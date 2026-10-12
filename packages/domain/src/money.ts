/**
 * Money is always an integer count of the asset's smallest unit. Stellar classic assets and
 * their Stellar Asset Contracts use 7 decimal places.
 */
export const STELLAR_DECIMALS = 7;

const DECIMAL_PATTERN = /^(\d{1,15})(?:\.(\d{1,7}))?$/;

export function parseAmount(input: string, decimals = STELLAR_DECIMALS): bigint {
  const normalized = input.trim().replaceAll(",", "");
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new RangeError(`Not a valid non-negative amount: "${input}"`);
  const [, whole = "0", fraction = ""] = match;
  if (fraction.length > decimals) throw new RangeError(`More than ${decimals} decimal places: "${input}"`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function formatAmount(units: bigint, opts: { decimals?: number; minFraction?: number; grouping?: boolean } = {}): string {
  const decimals = opts.decimals ?? STELLAR_DECIMALS;
  const minFraction = opts.minFraction ?? 2;
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString();
  let fraction = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fraction.length < minFraction) fraction = fraction.padEnd(minFraction, "0");
  const grouped = opts.grouping === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Splits `total` by basis points; the remainder from integer division lands on the last share. */
export function splitByBasisPoints(total: bigint, bps: readonly number[]): bigint[] {
  const sum = bps.reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new RangeError(`Basis points must sum to 10000, got ${sum}`);
  const shares = bps.map((b) => (total * BigInt(b)) / 10_000n);
  const allocated = shares.reduce((a, b) => a + b, 0n);
  shares[shares.length - 1]! += total - allocated;
  return shares;
}

export function sumUnits(values: readonly bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}
