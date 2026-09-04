import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { DonateButton } from "../components/donate-button";
import { parseTripInput } from "../utils/parseTripInput";

export default function HomeScreen() {
  const router = useRouter();
  const [tripInput, setTripInput] = useState("");
  const [error, setError] = useState<string | null>(null);

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
        <Text style={styles.title}>Fair Share</Text>
        <Text style={styles.subtitle}>Open a trip by ID or link.</Text>

        <TextInput
          value={tripInput}
          onChangeText={(value) => {
            setTripInput(value);
            if (error) {
              setError(null);
            }
          }}
          placeholder="32-hex trip id or /t/... link"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Trip ID or link"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.button} onPress={handleOpenTrip} accessibilityRole="button">
          <Text style={styles.buttonText}>Open trip</Text>
        </Pressable>
        <DonateButton />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f0e6",
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: "700",
    color: "#1f2937",
  },
  subtitle: {
    fontSize: 16,
    color: "#4b5563",
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#d6c7b0",
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#7c4a20",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "#b91c1c",
    fontSize: 14,
  },
});
