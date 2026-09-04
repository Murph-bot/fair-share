import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { configurePhotoSessionStore } from "../api/photoSession";
import { createSecureTokenStore } from "../api/secureTokenStore";

export default function RootLayout() {
  const [storeReady, setStoreReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void createSecureTokenStore().then((store) => {
      if (cancelled) {
        return;
      }
      configurePhotoSessionStore(store);
      setStoreReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!storeReady) {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
