import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { configureDataStorage, configureStorage } from "../api/storage";
import { createSecureTokenStore } from "../api/secureTokenStore";
import { fileDataStore } from "../api/fileDataStore";
import { Colors, type ColorTheme } from "../constants/theme";

/**
 * Privacy-friendly crash handling: no analytics or tracking.
 * Errors show a friendly alert; nothing leaves the device.
 */
if (typeof ErrorUtils !== "undefined") {
  const previousHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      Alert.alert(
        "Something went wrong",
        "Your saved data is safe. Please try again.",
        [{ text: "OK" }],
      );
    }
    previousHandler(error, isFatal);
  });
}

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
      configureStorage(store);
      // Bulk data (trips, queues) exceeds SecureStore's ~2KB iOS value
      // limit — it persists as files instead. Secrets stay in the store above.
      configureDataStorage(fileDataStore());
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
