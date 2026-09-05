import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, Text, useColorScheme } from "react-native";

import { Colors, type ColorTheme } from "../constants/theme";
import { resolveDonateUrl } from "../utils/donate";

export function DonateButton() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = makeStyles(colors);
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

function makeStyles(colors: ColorTheme) {
  return StyleSheet.create({
    button: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: colors.backgroundElement,
      borderWidth: 1,
      borderColor: colors.rule,
      alignItems: "center",
      justifyContent: "center",
    },
    text: {
      color: colors.tint,
      fontWeight: "700",
    },
  });
}
