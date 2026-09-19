import type { Config } from "tailwindcss";

// Ported (not copy-pasted) from the Stitch dark-theme design system the
// user supplied in ~/Documents/stitch_dark_theme_interface_design/DESIGN.md
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#051424",
        surface: "#051424",
        "surface-container-lowest": "#010f1f",
        "surface-container-low": "#0d1c2d",
        "surface-container": "#122131",
        "surface-container-high": "#1c2b3c",
        "surface-container-highest": "#273647",
        "surface-bright": "#2c3a4c",
        "on-surface": "#d4e4fa",
        "on-surface-variant": "#bcc9cd",
        outline: "#869397",
        "outline-variant": "#3d494c",
        primary: "#4cd7f6",
        "on-primary": "#003640",
        "primary-container": "#06b6d4",
        secondary: "#4edea3",
        "on-secondary": "#003824",
        "secondary-container": "#00a572",
        tertiary: "#ffb95f",
        "on-tertiary": "#472a00",
        "tertiary-container": "#e79400",
        error: "#ffb4ab",
        "on-error": "#690005",
        "error-container": "#93000a",
      },
      fontFamily: {
        headline: ["Plus Jakarta Sans", "sans-serif"],
        body: ["Inter", "sans-serif"],
        code: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
