import { ValidationError } from "./errors";

export function equalSplit(amountCents: number, n: number): number[] {
  if (amountCents <= 0) {
    throw new ValidationError(`amount_cents must be positive, got ${amountCents}`);
  }
  if (n < 1) {
    throw new ValidationError(`n must be at least 1, got ${n}`);
  }

  const base = Math.floor(amountCents / n);
  const remainder = amountCents % n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function weightedSplit(amountCents: number, weights: number[]): number[] {
  if (amountCents <= 0) {
    throw new ValidationError(`amount_cents must be positive, got ${amountCents}`);
  }
  if (weights.length === 0) {
    throw new ValidationError("weights must not be empty");
  }
  if (weights.some((w) => w <= 0)) {
    throw new ValidationError(`All weights must be positive, got ${weights}`);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const floors = weights.map((w) => Math.floor((amountCents * w) / totalWeight));
  const remainders = weights.map((w) => (amountCents * w) % totalWeight);
  const leftover = amountCents - floors.reduce((a, b) => a + b, 0);

  const order = [...weights.keys()].sort((i, j) => remainders[j] - remainders[i] || i - j);
  for (let k = 0; k < leftover; k++) {
    floors[order[k]] += 1;
  }

  return floors;
}
