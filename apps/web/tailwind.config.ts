import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  // Manual light/dark/system toggle (ThemeProvider) drives a `dark` class on
  // <html>; "system" resolves via prefers-color-scheme at runtime.
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: "#0f172a",
        paper: "#f8fafc",
      },
    },
  },
  plugins: [],
} satisfies Config;
