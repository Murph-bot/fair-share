import { ValidationError } from "./errors";

const AMOUNT_RE = /^[€$]?(\d+(?:\.\d{1,2})?)$/;

function normalizeAmount(raw: string): string {
  const trimmed = raw.trim();
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  if (hasComma && !hasDot) {
    return trimmed.replace(",", ".");
  }
  return trimmed;
}

export function parseAmount(raw: string): number {
  const m = AMOUNT_RE.exec(normalizeAmount(raw));
  if (!m) {
    throw new ValidationError(
      `Invalid amount: ${JSON.stringify(raw)}. Use formats like 60, 60.00, or €60.50`,
    );
  }

  const numeric = m[1];
  let cents: number;
  if (numeric.includes(".")) {
    const [integerPart, decimalPart] = numeric.split(".");
    cents = Number.parseInt(integerPart, 10) * 100 + Number.parseInt(decimalPart.padEnd(2, "0"), 10);
  } else {
    cents = Number.parseInt(numeric, 10) * 100;
  }

  if (cents <= 0) {
    throw new ValidationError(`Amount must be positive, got: ${JSON.stringify(raw)}`);
  }

  return cents;
}

export function centsToEuro(cents: number): string {
  const abs = Math.abs(cents);
  const body = `€${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${body}` : body;
}
