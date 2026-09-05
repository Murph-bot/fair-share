import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { createRemoteTrip } from "../api/tripApi";
import { savePhotoPin, savePhotoToken } from "../api/photoSession";
import { DonateButton } from "../components/donate-button";
import { Colors } from "../constants/theme";
import { parseTripInput } from "../utils/parseTripInput";

export default function HomeScreen() {
  const router = useRouter();
  const [tripName, setTripName] = useState("");
  const [tripInput, setTripInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCreateTrip = async () => {
    const name = tripName.trim();
    if (!name) {
      setError("Enter a trip name to get started");
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
      setError(caught instanceof Error ? caught.message : "Could not create trip");
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.kicker}>Fair Share</Text>
        <Text style={styles.title}>Split trip expenses fairly</Text>
        <Text style={styles.subtitle}>Create a trip, add people, and share the link. No accounts, no ads.</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Create a trip</Text>
          <TextInput
            value={tripName}
            onChangeText={(value) => {
              setTripName(value);
              if (error) setError(null);
            }}
            placeholder="Athens weekend"
            autoCapitalize="words"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Trip name"
            editable={!busy}
          />
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={() => void handleCreateTrip()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Create trip"
          >
            <Text style={styles.buttonText}>{busy ? "Creating…" : "Create trip"}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Open a trip</Text>
          <TextInput
            value={tripInput}
            onChangeText={(value) => {
              setTripInput(value);
              if (error) setError(null);
            }}
            placeholder="Paste a Fair Share link"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Trip link or ID"
            editable={!busy}
          />
          <Pressable
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
            onPress={handleOpenTrip}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Open trip"
          >
            <Text style={styles.secondaryButtonText}>Open trip</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <DonateButton />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 20,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: Colors.light.textSecondary,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: Colors.light.text,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.text,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: Colors.light.rule,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: Colors.light.backgroundElement,
    color: Colors.light.text,
    fontSize: 16,
  },
  button: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: Colors.light.text,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: Colors.light.background,
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: Colors.light.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.light.text,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: Colors.light.text,
    fontSize: 16,
    fontWeight: "700",
  },
  error: {
    color: Colors.light.negative,
    fontSize: 14,
    fontWeight: "600",
  },
});
