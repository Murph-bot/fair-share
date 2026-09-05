import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { createRemoteDemoTrip, createRemoteTrip } from "../api/tripApi";
import { savePhotoPin, savePhotoToken } from "../api/photoSession";
import { loadRecentTrips, type RecentTrip } from "../api/recentTrips";
import { DonateButton } from "../components/donate-button";
import { Colors, type ColorTheme } from "../constants/theme";
import { useTranslation } from "../i18n";
import { parseTripInput } from "../utils/parseTripInput";

function makeStyles(colors: ColorTheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 24,
      gap: 20,
      flexGrow: 1,
    },
    recentList: {
      gap: 8,
    },
    recentItem: {
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.backgroundElement,
      borderWidth: 1,
      borderColor: colors.rule,
    },
    recentName: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
    },
    recentMeta: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    kicker: {
      fontSize: 12,
      letterSpacing: 2,
      textTransform: "uppercase",
      color: colors.textSecondary,
    },
    title: {
      fontSize: 32,
      fontWeight: "700",
      color: colors.text,
    },
    subtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    section: {
      gap: 12,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: colors.rule,
      borderRadius: 12,
      paddingHorizontal: 14,
      backgroundColor: colors.backgroundElement,
      color: colors.text,
      fontSize: 16,
    },
    button: {
      minHeight: 52,
      borderRadius: 12,
      backgroundColor: colors.text,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    buttonText: {
      color: colors.background,
      fontSize: 16,
      fontWeight: "700",
    },
    secondaryButton: {
      minHeight: 52,
      borderRadius: 12,
      backgroundColor: colors.backgroundElement,
      borderWidth: 1,
      borderColor: colors.text,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    error: {
      color: colors.negative,
      fontSize: 14,
      fontWeight: "600",
    },
  });
}

export default function HomeScreen() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const router = useRouter();
  const [tripName, setTripName] = useState("");
  const [tripInput, setTripInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<RecentTrip[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadRecentTrips().then((trips) => {
      if (!cancelled) {
        setRecents(trips);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreateTrip = async () => {
    const name = tripName.trim();
    if (!name) {
      setError(t("Enter a trip name to get started"));
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const created = await createRemoteTrip(name);
      savePhotoPin(created.id, created.pin);
      savePhotoToken(created.id, created.photos_token);
      router.push({ pathname: "/t/[id]", params: { id: created.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Could not create trip"));
      setBusy(false);
    }
  };

  const handleOpenTrip = () => {
    const parsed = parseTripInput(tripInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setError(null);
    router.push({ pathname: "/t/[id]", params: { id: parsed.id } });
  };

  const handleOpenRecent = (id: string) => {
    router.push({ pathname: "/t/[id]", params: { id } });
  };

  const handleCreateDemoTrip = async () => {
    setError(null);
    setBusy(true);
    try {
      const created = await createRemoteDemoTrip(t("Demo trip"));
      savePhotoPin(created.id, created.pin);
      savePhotoToken(created.id, created.photos_token);
      router.push({ pathname: "/t/[id]", params: { id: created.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Could not create trip"));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.kicker}>{t("Fair Share")}</Text>
        <Text style={styles.title}>{t("Split trip expenses fairly")}</Text>
        <Text style={styles.subtitle}>{t("Create a trip, add people, and share the link. No accounts, no ads.")}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("Create a trip")}</Text>
          <TextInput
            value={tripName}
            onChangeText={(value) => {
              setTripName(value);
              if (error) setError(null);
            }}
            placeholder={t("Athens weekend")}
            autoCapitalize="words"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel={t("Trip name")}
            editable={!busy}
          />
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={() => void handleCreateTrip()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("Create trip")}
          >
            <Text style={styles.buttonText}>{busy ? t("Creating…") : t("Create trip")}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("Open a trip")}</Text>
          <TextInput
            value={tripInput}
            onChangeText={(value) => {
              setTripInput(value);
              if (error) setError(null);
            }}
            placeholder={t("Paste a Fair Share link")}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel={t("Trip link or ID")}
            editable={!busy}
          />
          <Pressable
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
            onPress={handleOpenTrip}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("Open trip")}
          >
            <Text style={styles.secondaryButtonText}>{t("Open trip")}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Pressable
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
            onPress={() => void handleCreateDemoTrip()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("Try a demo")}
          >
            <Text style={styles.secondaryButtonText}>{t("Try a demo")}</Text>
          </Pressable>
        </View>

        {recents.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("Recent trips")}</Text>
            <View style={styles.recentList}>
              {recents.map((trip) => (
                <Pressable
                  key={trip.id}
                  style={styles.recentItem}
                  onPress={() => handleOpenRecent(trip.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t("Open {{name}}", { name: trip.name })}
                >
                  <Text style={styles.recentName}>{trip.name}</Text>
                  <Text style={styles.recentMeta}>{trip.id}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <DonateButton />
      </ScrollView>
    </SafeAreaView>
  );
}
