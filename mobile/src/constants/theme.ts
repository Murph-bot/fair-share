export const Colors = {
  light: {
    text: "#2a1c14",
    textSecondary: "#5c4033",
    background: "#f4f0e6",
    backgroundElement: "#fbf7ef",
    backgroundSelected: "#2a1c14",
    tint: "#7c4a20",
    rule: "#cbbda8",
    positive: "#1f4d32",
    negative: "#7a2e1f",
  },
  dark: {
    text: "#fbf7ef",
    textSecondary: "#cbbda8",
    background: "#1a1410",
    backgroundElement: "#2a2018",
    backgroundSelected: "#f4f0e6",
    tint: "#d4a574",
    rule: "#5c4033",
    positive: "#6cc98a",
    negative: "#e08b7a",
  },
} as const;

export type ColorTheme = typeof Colors.light | typeof Colors.dark;
export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;
