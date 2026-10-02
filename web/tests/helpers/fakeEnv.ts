import type {
  D1Like,
  Env,
  KVLike,
  R2BucketLike,
  R2Metadata,
} from "../../../pages/functions/_shared/env";

export const TEST_PEPPER = "test-pepper-for-testing-only-1234";

export type FakePhoto = { data: Uint8Array; metadata: R2Metadata; uploaded: Date };

export function makeFakeEnv(opts: { r2PageSize?: number } = {}): {
  env: Env;
  trips: Map<string, unknown>;
  photos: Map<string, FakePhoto>;
  pinAttempts: Map<string, unknown>;
} {
  const trips = new Map<string, unknown>();
  const photos = new Map<string, FakePhoto>();
  const pinAttempts = new Map<string, unknown>();

  const d1: D1Like = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const [a, b, c] = values;
          return {
            async first<T>() {
              if (sql.includes("INSERT INTO pin_attempts")) {
                // (key, resetAtIfNew, now): atomic like D1's single writer.
                const [key, resetAt, now] = values as [string, number, number];
                const cur = pinAttempts.get(key) as { count: number; resetAt: number } | undefined;
                const next =
                  cur && cur.resetAt > now ? { count: cur.count + 1, resetAt: cur.resetAt } : { count: 1, resetAt };
                pinAttempts.set(key, next);
                return { count: next.count } as T;
              }
              if (sql.includes("SELECT count FROM pin_attempts")) {
                const [key, now] = values as [string, number];
                const cur = pinAttempts.get(key) as { count: number; resetAt: number } | undefined;
                return (cur && cur.resetAt > now ? { count: cur.count } : null) as T;
              }
              if (sql.includes("SELECT payload FROM trips")) {
                const raw = trips.get(String(a));
                return (raw === undefined ? null : { payload: JSON.stringify(raw) }) as T;
              }
              return null as T;
            },
            async run() {
              if (sql.includes("INSERT INTO trips")) {
                trips.set(String(a), JSON.parse(String(b)) as unknown);
                void c;
              } else if (sql.includes("UPDATE trips SET payload")) {
                // (payload, updated_at, id, expectedRev)
                const [payload, , id, expectedRev] = values;
                const current = trips.get(String(id)) as { rev?: unknown } | undefined;
                const rev = typeof current?.rev === "number" ? current.rev : 0;
                if (current === undefined || rev !== expectedRev) {
                  return { meta: { changes: 0 } };
                }
                trips.set(String(id), JSON.parse(String(payload)) as unknown);
                return { meta: { changes: 1 } };
              } else if (sql.includes("DELETE FROM pin_attempts WHERE key")) {
                pinAttempts.delete(String(a));
              } else if (sql.includes("UPDATE pin_attempts SET count")) {
                const cur = pinAttempts.get(String(a)) as { count: number; resetAt: number } | undefined;
                if (cur) pinAttempts.set(String(a), { ...cur, count: Math.max(cur.count - 1, 0) });
              } else if (sql.includes("DELETE FROM pin_attempts WHERE reset_at")) {
                for (const [key, v] of pinAttempts) {
                  if ((v as { resetAt: number }).resetAt <= Number(a)) pinAttempts.delete(key);
                }
              } else if (sql.includes("DELETE FROM trips")) {
                trips.delete(String(a));
              }
              return { meta: {} };
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
      // Mirrors real R2: customMetadata only when include asks for it,
      // and results are paged (limit, cursor = next start index).
      const prefix = options?.prefix ?? "";
      const keys = [...photos.keys()].filter((key) => key.startsWith(prefix)).sort();
      const pageSize = Math.min(options?.limit ?? 1000, opts.r2PageSize ?? 1000);
      const start = options?.cursor ? Number(options.cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const withMeta = options?.include?.includes("customMetadata") ?? false;
      const truncated = start + pageSize < keys.length;
      return {
        objects: page.map((key) => {
          const photo = photos.get(key) as FakePhoto;
          return {
            key,
            uploaded: photo.uploaded,
            size: photo.data.byteLength,
            ...(withMeta ? { customMetadata: photo.metadata } : {}),
          };
        }),
        truncated,
        ...(truncated ? { cursor: String(start + pageSize) } : {}),
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
    photos,
    pinAttempts,
  };
}
