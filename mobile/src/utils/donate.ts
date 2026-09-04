export function resolveDonateUrl(
  env: Record<string, string | undefined>,
  extra: { donateUrl?: unknown },
): string | null {
  const candidates = [env.EXPO_PUBLIC_DONATE_URL, extra.donateUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const url = candidate.trim();
    if (!url) {
      continue;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") {
        return url;
      }
    } catch {
      continue;
    }
  }
  return null;
}
