import { TRIP_ID_RE } from "../domain";

export type ParseTripInputResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const INVALID_MESSAGE = "Paste a trip ID or /t/<id> link";

function extractTripId(input: string): string | null {
  const directMatch = /(?:^|\/)t\/([a-f0-9]{32})(?:[/?#].*)?$/i.exec(input);
  if (directMatch) {
    return directMatch[1].toLowerCase();
  }

  try {
    const url = new URL(input);
    const urlMatch = /(?:^|\/)t\/([a-f0-9]{32})(?:[/?#].*)?$/i.exec(url.pathname);
    if (urlMatch) {
      return urlMatch[1].toLowerCase();
    }
  } catch {
    // Not a URL.
  }

  return null;
}

export function parseTripInput(raw: string): ParseTripInputResult {
  const input = raw.trim();
  if (!input) {
    return { ok: false, error: "Enter a trip ID or link" };
  }

  if (TRIP_ID_RE.test(input)) {
    return { ok: true, id: input.toLowerCase() };
  }

  const extracted = extractTripId(input);
  if (extracted !== null && TRIP_ID_RE.test(extracted)) {
    return { ok: true, id: extracted };
  }

  return { ok: false, error: INVALID_MESSAGE };
}
