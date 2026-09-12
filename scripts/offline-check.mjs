/**
 * Offline PWA verification with Playwright.
 * Prereq: `npx wrangler pages dev web/dist --port 8788` running, and a trip
 * with at least one photo that was previously viewed online.
 *
 * Uses route-based network failure (with experimental SW network events)
 * because Chromium's setOffline has known quirks with service workers.
 *
 * Usage: node scripts/offline-check.mjs <tripId>
 */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
import { chromium } from "playwright";

const tripId = process.argv[2];
if (!tripId) {
  console.error("usage: node scripts/offline-check.mjs <tripId>");
  process.exit(1);
}

const BASE = "http://localhost:8788";
const url = `${BASE}/t/${tripId}`;

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: "allow" });
const page = await context.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
    errors.push(msg.text());
  }
});

// 1. Load online so the service worker caches trip + photo.
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".people", { timeout: 15000 });
const onlineTitle = await page.locator("h1").first().textContent();
console.log(`online trip title: ${onlineTitle}`);

// Wait for the SW to control the page.
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  }
});

// 2. Reload ONLINE once more so the trip + photo requests go through the SW
//    and land in the caches.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const photoCountOnline = await page.locator(".moment-tile").count();
console.log(`photos visible online: ${photoCountOnline}`);

// 3. Kill the network (including service worker fetches) and reload.
await context.route("**/*", (route) => route.abort("internetdisconnected"));
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(2500);

const titleOffline = await page.locator("h1").first().textContent().catch(() => null);
const photoCountOffline = await page.locator(".moment-tile").count();
const imgOk = await page
  .locator(".moment-tile img")
  .evaluateAll((imgs) => imgs.every((img) => img.complete && img.naturalWidth > 0))
  .catch(() => false);

console.log(`offline trip title: ${titleOffline ?? "(none)"}`);
console.log(`photos visible offline: ${photoCountOffline}, images decoded: ${imgOk}`);
console.log(`console errors: ${errors.length}`);
if (errors.length) { for (const e of errors) console.log("  ERR:", e.slice(0, 200)); }

const passed =
  titleOffline !== null && titleOffline === onlineTitle && photoCountOffline > 0 && imgOk && errors.length === 0;
console.log(passed ? "PASS" : "FAIL");

await context.unroute("**/*");
await browser.close();
process.exit(passed ? 0 : 1);
