/**
 * Structural types for Cloudflare bindings so handlers stay testable
 * without pulling in @cloudflare/workers-types.
 */

export interface D1Prepared {
  bind(...values: unknown[]): {
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<{ meta: unknown }>;
    all<T = unknown>(): Promise<{ results: T[] }>;
  };
}

export interface D1Like {
  prepare(sql: string): D1Prepared;
}

export type R2Metadata = Record<string, string>;

export interface R2ObjectLike {
  key: string;
  uploaded: Date;
  size: number;
  customMetadata?: R2Metadata;
}

export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  customMetadata?: R2Metadata;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { customMetadata?: R2Metadata },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: R2ObjectLike[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface KVLike {
  get(key: string, type?: "json"): Promise<unknown>;
  put(key: string, value: unknown, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export type Env = {
  FAIRSHARE_DB: D1Like;
  FAIRSHARE_PHOTOS: R2BucketLike;
  PIN_ATTEMPTS: KVLike;
  PHOTO_PIN_PEPPER: string;
  CRON_SECRET?: string;
};
