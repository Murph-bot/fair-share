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
      const prefix = options?.prefix ?? "";
      const keys = [...photos.keys()].filter((key) => key.startsWith(prefix)).sort();
      return {
        objects: keys.map((key) => {
          const photo = photos.get(key) as FakePhoto;
          return {
            key,
            uploaded: photo.uploaded,
            size: photo.data.byteLength,
            customMetadata: photo.metadata,
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
    photos,
    pinAttempts,
  };
}
