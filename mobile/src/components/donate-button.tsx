import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, Text } from "react-native";

import { resolveDonateUrl } from "../utils/donate";

export function DonateButton() {
  const url = resolveDonateUrl(
    { EXPO_PUBLIC_DONATE_URL: process.env.EXPO_PUBLIC_DONATE_URL },
    { donateUrl: Constants.expoConfig?.extra?.donateUrl },
  );
  if (!url) {
    return null;
  }

  return (
    <Pressable
      style={styles.button}
      onPress={() => void WebBrowser.openBrowserAsync(url)}
      accessibilityRole="link"
      accessibilityLabel="Support Fair Share"
    >
      <Text style={styles.text}>Support Fair Share</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#efe5d4",
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#5c3b1e",
    fontWeight: "700",
  },
});
