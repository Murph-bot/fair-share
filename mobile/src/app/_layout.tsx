import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { configurePhotoSessionStore } from "../api/photoSession";
import { createSecureTokenStore } from "../api/secureTokenStore";
import { Colors, type ColorTheme } from "../constants/theme";

function makeStyles(colors: ColorTheme) {
  return StyleSheet.create({
    loadingContainer: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    },
    loadingTitle: {
      fontSize: 32,
      fontWeight: "700",
      color: colors.text,
    },
  });
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = makeStyles(colors);
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
        <SafeAreaView style={styles.loadingContainer}>
          <Text style={styles.loadingTitle}>Fair Share</Text>
          <ActivityIndicator color={Colors.light.text} />
        </SafeAreaView>
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
