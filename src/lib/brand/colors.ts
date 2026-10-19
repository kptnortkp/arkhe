// Mirrors the oklch tokens in globals.css as hex (measured in Chrome) for places that can't read CSS.
export const brandColors = {
  /** light --stage */
  stage: "#26214e",
  /** dark --stage */
  stageDark: "#1a1436",
  /** --stage-foreground */
  stageForeground: "#f9f5ec",
  /** light --background */
  background: "#f9f6f1",
  /** dark --background */
  backgroundDark: "#0d0b19",
  /** light --foreground */
  foreground: "#161929",
  /** dark --foreground */
  foregroundDark: "#f1eee7",
  /** light --muted-foreground */
  mutedForeground: "#5f6272",
  /** dark --muted-foreground */
  mutedForegroundDark: "#9a9eab",
  /** light --primary */
  primary: "#322c61",
  /** light --primary-foreground */
  primaryForeground: "#fbf8f1",
  /** dark --primary (gold) */
  primaryDark: "#e8b45e",
  /** dark --primary-foreground */
  primaryForegroundDark: "#121524",
} as const;
