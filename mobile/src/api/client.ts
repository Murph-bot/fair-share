export const DEFAULT_API_BASE_URL = "https://fair-share-trips.netlify.app";

export function apiBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_FAIRSHARE_API ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

export function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path}`;
}

export async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Ignore invalid JSON and fall back to status text.
  }

  return `Request failed (${response.status})`;
}
