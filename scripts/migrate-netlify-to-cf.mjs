#!/usr/bin/env node
/**
 * One-time migration: Netlify Blobs -> Cloudflare (D1 + R2).
 *
 * Prerequisites:
 *   - NETLIFY_SITE_ID and NETLIFY_ACCESS_TOKEN (Netlify personal access token
 *     with access to the site) to read the production Blob stores. If
 *     NETLIFY_ACCESS_TOKEN is unset, the token from the local Netlify CLI
 *     login (~/Library/Preferences/netlify/config.json) is used.
 *   - Either R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (R2 API
 *     token with object read/write on the fairshare-photos bucket) or an
 *     authenticated wrangler login — with no R2 keys the script uploads via
 *     `wrangler r2 object put` (custom metadata is not preserved in that
 *     mode; uploadedAt falls back to the R2 upload time).
 *   - wrangler logged in, D1 database `fairshare-db` created, and
 *     `wrangler d1 execute fairshare-db --remote --file db/schema.sql` already run.
 *
 * Usage:
 *   NETLIFY_SITE_ID=... node scripts/migrate-netlify-to-cf.mjs
 *
 * Safe to re-run (upserts). Set DRY_RUN=1 to only report counts.
 *
 * Note: full-res originals that live only in Cloudinary are NOT migrated
 * (Cloudinary is being decommissioned); the gallery display copies are the
 * canonical data and migrate fully.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getStore } from "@netlify/blobs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const DRY_RUN = process.env.DRY_RUN === "1";
const SITE_ID = process.env.NETLIFY_SITE_ID;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const USE_WRANGLER_R2 = !R2_ACCOUNT_ID;

function netlifyCliToken() {
  const candidates = [
    join(homedir(), "Library", "Preferences", "netlify", "config.json"),
    join(homedir(), ".config", "netlify", "config.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const config = JSON.parse(readFileSync(path, "utf8"));
      for (const user of Object.values(config.users ?? {})) {
        const token = user?.auth?.token;
        if (typeof token === "string" && token) {
          return token;
        }
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

const TOKEN = process.env.NETLIFY_ACCESS_TOKEN ?? netlifyCliToken();

if (!SITE_ID || !TOKEN) {
  console.error("Missing NETLIFY_SITE_ID, and no Netlify token in env or CLI config");
  process.exit(1);
}
if (!USE_WRANGLER_R2 && (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error("R2_ACCOUNT_ID was set but R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are missing");
  process.exit(1);
}

const r2 = USE_WRANGLER_R2
  ? null
  : new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

const PHOTO_ID_RE = /^[a-f0-9]{32}$/;

function runWrangler(args) {
  if (DRY_RUN) {
    console.log(`[dry-run] wrangler ${args.join(" ")}`);
    return;
  }
  execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
}

async function migrateTrips() {
  const store = getStore({ name: "trips", siteID: SITE_ID, token: TOKEN });
  const { blobs } = await store.list();
  console.log(`Trips found: ${blobs.length}`);

  const rows = [];
  for (const blob of blobs) {
    const raw = await store.get(blob.key, { type: "json" });
    if (raw === null) {
      continue;
    }
    const payload = JSON.stringify(raw).replaceAll("'", "''");
    rows.push(`INSERT INTO trips (id, payload, updated_at) VALUES ('${blob.key}', '${payload}', '${new Date().toISOString()}') ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`);
  }

  if (rows.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), "fairshare-migrate-"));
    const sqlPath = join(dir, "trips.sql");
    writeFileSync(sqlPath, rows.join("\n"));
    runWrangler(["d1", "execute", "fairshare-db", "--remote", "--file", sqlPath]);
    rmSync(dir, { recursive: true, force: true });
  }
  return blobs.length;
}

async function migratePhotos() {
  const store = getStore({ name: "photos", siteID: SITE_ID, token: TOKEN });
  const { blobs } = await store.list();
  console.log(`Photo blobs found: ${blobs.length}`);

  let uploaded = 0;
  let skipped = 0;
  for (const blob of blobs) {
    const parts = blob.key.split("/");
    if (parts.length !== 2 || !PHOTO_ID_RE.test(parts[1] ?? "")) {
      skipped += 1;
      continue;
    }
    const result = await store.getWithMetadata(blob.key, { type: "arrayBuffer" });
    if (!result || !result.data) {
      skipped += 1;
      continue;
    }
    const metadata = result.metadata?.metadata ?? {};
    const contentType = typeof metadata.contentType === "string" ? metadata.contentType : "image/jpeg";
    const uploadedAt = typeof metadata.uploadedAt === "string" ? metadata.uploadedAt : new Date().toISOString();
    if (DRY_RUN) {
      console.log(`[dry-run] r2 put fairshare-photos/${blob.key} (${result.data.byteLength} bytes)`);
      uploaded += 1;
      continue;
    }
    if (USE_WRANGLER_R2) {
      const dir = mkdtempSync(join(tmpdir(), "fairshare-photo-"));
      const filePath = join(dir, parts[1]);
      writeFileSync(filePath, Buffer.from(result.data));
      runWrangler([
        "r2", "object", "put", `fairshare-photos/${blob.key}`,
        "--remote",
        "--file", filePath,
        "--content-type", contentType,
      ]);
      rmSync(dir, { recursive: true, force: true });
    } else {
      // Legacy originals lived in Cloudinary; they are not migrated, so display
      // copies carry hasOriginal=0.
      const customMetadata = {
        contentType,
        uploadedAt,
        tripId: parts[0],
        hasOriginal: "0",
      };
      await r2.send(
        new PutObjectCommand({
          Bucket: "fairshare-photos",
          Key: blob.key,
          Body: new Uint8Array(result.data),
          ContentType: contentType,
          Metadata: customMetadata,
        }),
      );
    }
    uploaded += 1;
  }
  console.log(`Photos uploaded: ${uploaded}, skipped: ${skipped}`);
  return uploaded;
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== MIGRATION ===");
  const tripCount = await migrateTrips();
  const photoCount = await migratePhotos();
  console.log("Done.");
  console.log(`Migrated: ${tripCount} trips, ${photoCount} photos.`);
  console.log("Spot-check: open a few trips on https://fair-share-trips.pages.dev and compare with netlify.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
