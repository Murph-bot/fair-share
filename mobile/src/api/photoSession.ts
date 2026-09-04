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

export function configurePhotoSessionStore(next: TokenStore): void {
  store = next;
}

function tokenKey(tripId: string): string {
  return `fairshare.photos.token.${tripId}`;
}

export async function loadPhotoToken(tripId: string): Promise<string | undefined> {
  try {
    return (await store.getItem(tokenKey(tripId))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function savePhotoToken(tripId: string, token: string): Promise<void> {
  try {
    await store.setItem(tokenKey(tripId), token);
  } catch {
    /* private mode / SecureStore quota */
  }
}

export async function clearPhotoToken(tripId: string): Promise<void> {
  try {
    await store.removeItem(tokenKey(tripId));
  } catch {
    /* ignore */
  }
}
