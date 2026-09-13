import { Directory, File, Paths } from "expo-file-system";
import type { TokenStore } from "./storage";

const DATA_DIR = "fairshare-data";

function dataDirectory(): Directory {
  // Document (not cache) storage: the OS must not evict queued edits.
  const dir = new Directory(Paths.document, DATA_DIR);
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    /* directory may already exist */
  }
  return dir;
}

function fileFor(key: string): File {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new File(dataDirectory(), `${safe}.txt`);
}

/**
 * TokenStore backed by files for values that exceed SecureStore's ~2KB
 * iOS limit — trip snapshots, offline queues, photo lists. Secrets still
 * belong in SecureStore (see secureTokenStore).
 */
export function fileDataStore(): TokenStore {
  return {
    getItem: async (key) => {
      const file = fileFor(key);
      if (!file.exists) {
        return null;
      }
      return file.text();
    },
    setItem: async (key, value) => {
      fileFor(key).write(value);
    },
    removeItem: async (key) => {
      const file = fileFor(key);
      if (file.exists) {
        file.delete();
      }
    },
  };
}
