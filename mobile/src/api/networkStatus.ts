import { getNetworkStateAsync, NetworkStateEvent, addNetworkStateListener } from "expo-network";

export async function isOnline(): Promise<boolean> {
  try {
    const state = await getNetworkStateAsync();
    return state.isInternetReachable ?? true;
  } catch {
    return true;
  }
}

export { NetworkStateEvent, addNetworkStateListener };
