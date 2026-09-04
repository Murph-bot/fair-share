import { memoryTokenStore, type TokenStore } from "./photoSession";

export async function createSecureTokenStore(): Promise<TokenStore> {
  try {
    const SecureStore = await import("expo-secure-store");
    return {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    };
  } catch {
    return memoryTokenStore();
  }
}
