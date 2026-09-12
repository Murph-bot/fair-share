/**
 * Cloudflare Pages full-stack entry (_worker.js advanced mode).
 * Handles the API and photo routes in code, and serves static assets via the
 * ASSETS binding with an SPA fallback (Pages does not apply _redirects in
 * advanced mode, so the fallback lives here).
 */
import { handleApiRequest } from "./functions/api/[[path]]";
import { handlePhotoRequest } from "./functions/uploads/photos/[tripId]/[photoId]";
import type { Env } from "./functions/_shared/env";

const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

function withHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      return handleApiRequest(request, env);
    }

    const photoMatch = /^\/uploads\/photos\/([a-f0-9]{32})\/([a-f0-9]{32})$/.exec(path);
    if (photoMatch) {
      return handlePhotoRequest(request, env, photoMatch[1] ?? "", photoMatch[2] ?? "");
    }

    const assets = (env as unknown as { ASSETS: { fetch: (req: Request) => Promise<Response> } }).ASSETS;
    const response = await assets.fetch(request);

    // SPA fallback: unknown GET routes render the app shell.
    if (response.status === 404 && request.method === "GET") {
      const index = await assets.fetch(new Request(new URL("/index.html", request.url)));
      return withHeaders(
        new Response(index.body, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    }

    return withHeaders(response);
  },
};
