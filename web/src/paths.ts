// index.html has a base tag pointing at the root, and a host that mounts the app under a sub-path
// rewrites it. App URLs are relative to that base, so only this file needs to know about it.
export function appPath(pathname: string, baseURI: string): string {
  const base = new URL(baseURI).pathname.replace(/\/$/, "");
  const inside =
    pathname === base || pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
  return inside.replace(/\/$/, "") || "/";
}

// Under a host site, its other pages share the origin but aren't the app's to route.
export function isAppPath(pathname: string, baseURI: string): boolean {
  const base = new URL(baseURI).pathname.replace(/\/$/, "");
  return base === "" || pathname === base || pathname.startsWith(`${base}/`);
}

export function tripIdFromLink(input: string): string | null {
  try {
    const match = /\/t\/([a-f0-9]{32})\/?$/i.exec(new URL(input).pathname);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}
