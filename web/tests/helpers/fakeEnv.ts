import type {
  D1Like,
  Env,
  KVLike,
  R2BucketLike,
  R2Metadata,
} from "../../../pages/functions/_shared/env";

export const TEST_PEPPER = "test-pepper-for-testing-only-1234";

export type FakePhoto = { data: Uint8Array; metadata: R2Metadata; uploaded: Date };

export function makeFakeEnv(): {
  env: Env;
  trips: Map<string, unknown>;
  revisions: Map<string, number>;
  photos: Map<string, FakePhoto>;
  pinAttempts: Map<string, unknown>;
  counters: Map<string, { count: number; expiresAt: number }>;
} {
  const trips = new Map<string, unknown>();
  const revisions = new Map<string, number>();
  const photos = new Map<string, FakePhoto>();
  const pinAttempts = new Map<string, unknown>();
  const counters = new Map<string, { count: number; expiresAt: number }>();

  const storedPinHash = (id: string): unknown =>
    (trips.get(id) as { pin_hash?: unknown } | undefined)?.pin_hash;

  // Mirrors the SQL in pages/functions/_shared/stores.ts; the real statements
  // are exercised against local D1 (see the PR's verification notes).
  const d1: D1Like = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const [a, b, c, d] = values;
          return {
            async first<T>() {
              if (sql.includes("SELECT payload")) {
                const raw = trips.get(String(a));
                return (
                  raw === undefined
                    ? null
                    : { payload: JSON.stringify(raw), revision: revisions.get(String(a)) ?? 0 }
                ) as T;
              }
              if (sql.includes("INSERT INTO rate_limits")) {
                const key = String(a);
                const count = (counters.get(key)?.count ?? 0) + 1;
                counters.set(key, { count, expiresAt: Number(b) });
                return { count } as T;
              }
              if (sql.includes("revision = revision + 1")) {
                const id = String(c);
                if (!trips.has(id) || (revisions.get(id) ?? 0) !== d) {
                  return null as T;
                }
                const pinHash = storedPinHash(id);
                const next = JSON.parse(String(a)) as Record<string, unknown>;
                trips.set(id, pinHash === undefined ? next : { ...next, pin_hash: pinHash });
                const revision = (revisions.get(id) ?? 0) + 1;
                revisions.set(id, revision);
                return { revision, photos_locked: pinHash === undefined ? 0 : 1 } as T;
              }
              return null as T;
            },
            async run() {
              if (sql.includes("INSERT INTO trips")) {
                trips.set(String(a), JSON.parse(String(b)) as unknown);
                void c;
              } else if (sql.includes("json_set(payload, '$.pin_hash'")) {
                const id = String(c);
                if (!trips.has(id) || storedPinHash(id) !== undefined) {
                  return { meta: { changes: 0 } };
                }
                trips.set(id, { ...(trips.get(id) as object), pin_hash: a });
                return { meta: { changes: 1 } };
              } else if (sql.includes("DELETE FROM rate_limits")) {
                for (const [key, row] of counters) {
                  if (row.expiresAt < Number(a)) {
                    counters.delete(key);
                  }
                }
              } else if (sql.includes("DELETE FROM trips")) {
                trips.delete(String(a));
                revisions.delete(String(a));
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };

  const r2: R2BucketLike = {
    async get(key) {
      const photo = photos.get(key);
      if (!photo) {
        return null;
      }
      const data = photo.data.slice();
      return {
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        customMetadata: photo.metadata,
      };
    },
    async head(key) {
      const photo = photos.get(key);
      if (!photo) {
        return null;
      }
      return {
        key,
        uploaded: photo.uploaded,
        size: photo.data.byteLength,
        customMetadata: photo.metadata,
      };
    },
    async put(key, value, options) {
      let bytes: Uint8Array;
      if (value instanceof Uint8Array) {
        bytes = value.slice();
      } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value.slice(0));
      } else {
        bytes = new TextEncoder().encode(value);
      }
      photos.set(key, {
        data: bytes,
        metadata: options?.customMetadata ?? {},
        uploaded: new Date(),
      });
    },
    async delete(key) {
      photos.delete(key);
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const keys = [...photos.keys()].filter((key) => key.startsWith(prefix)).sort();
      return {
        // Like real R2, list() leaves out customMetadata unless asked for it.
        objects: keys.map((key) => {
          const photo = photos.get(key) as FakePhoto;
          return {
            key,
            uploaded: photo.uploaded,
            size: photo.data.byteLength,
          };
        }),
        truncated: false,
      };
    },
  };

  const kv: KVLike = {
    async get(key, type) {
      const value = pinAttempts.get(key);
      if (value === undefined) {
        return null;
      }
      if (type === "json" && typeof value === "string") {
        return JSON.parse(value) as unknown;
      }
      return value;
    },
    async put(key, value) {
      pinAttempts.set(key, value);
    },
    async delete(key) {
      pinAttempts.delete(key);
    },
  };

  return {
    env: {
      FAIRSHARE_DB: d1,
      FAIRSHARE_PHOTOS: r2,
      PIN_ATTEMPTS: kv,
      PHOTO_PIN_PEPPER: TEST_PEPPER,
    },
    trips,
    revisions,
    photos,
    pinAttempts,
    counters,
  };
}
