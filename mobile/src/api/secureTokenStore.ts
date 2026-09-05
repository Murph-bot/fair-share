import { type TokenStore } from "./storage";

export async function createSecureTokenStore(): Promise<TokenStore> {
  try {
    const SecureStore = await import("expo-secure-store");
    return {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    };
  } catch {
    const { memoryTokenStore } = await import("./storage");
    return memoryTokenStore();
  }
}
