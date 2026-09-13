export type TokenStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export function memoryTokenStore(): TokenStore {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

let store: TokenStore = memoryTokenStore();
let dataStore: TokenStore = memoryTokenStore();

export function configureStorage(next: TokenStore): void {
  store = next;
}

export function getStore(): TokenStore {
  return store;
}

// Bulk payloads (trip snapshots, offline queues, recents) do not fit
// SecureStore's ~2KB iOS value limit — they live in a file-backed store.
export function configureDataStorage(next: TokenStore): void {
  dataStore = next;
}

export function getDataStore(): TokenStore {
  return dataStore;
}
