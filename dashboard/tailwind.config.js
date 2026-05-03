/** @type {import('tailwindcss').Config} */
// Design: logo-derived palette — pale gold bg | near-black brown sidebar | amber accent
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Derived directly from the HoneyBee logo image
        honey: {
          50:  "#FFFDE8",  // near-white warm
          100: "#FEF9C3",  // very pale gold
          200: "#FEF3C7",  // page background (logo bg)
          300: "#FDE68A",  // wing highlight
          400: "#FCD34D",  // wing gold
          500: "#F59E0B",  // primary amber (bee body)
          600: "#D97706",  // deep amber (honey drip)
          700: "#B45309",  // dark amber (honey pot)
          800: "#92400E",  // very dark amber
          900: "#78350F",  // near-brown
        },
        // Dark sidebar: near-black brown from bee outlines
        bark: {
          500: "#1C0A00",
          700: "#140700",
          800: "#0E0400",
          900: "#080200",
        },
        // Warm surface tints
        surface: {
          50:  "#FFFEF5",
          100: "#FFFEF0",
          200: "#FFFDE8",
          300: "#FEF9D0",
          400: "#FEF3C7",
        },
        cream: { 100: "#FFFEF5", 200: "#FEF3C7" },
      },
      fontFamily: {
        display: ['"Inter"', '"Plus Jakarta Sans"', "ui-sans-serif", "system-ui"],
      },
      boxShadow: {
        honey:  "0 0 0 1px rgba(247,171,6,0.18), 0 4px 20px -4px rgba(247,171,6,0.30)",
        card:   "0 1px 4px rgba(0,0,0,0.5)",
      },
      keyframes: {
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%":     { transform: "translateY(-5px)" },
        },
        "pulse-glow": {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(247,171,6,.55)" },
          "50%":     { boxShadow: "0 0 0 10px rgba(247,171,6,0)" },
        },
        "pulse-green": {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(16,185,129,.55)" },
          "50%":     { boxShadow: "0 0 0 8px rgba(16,185,129,0)" },
        },
        "fade-up": {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "spin-slow": {
          "0%":   { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        float:         "float 4s ease-in-out infinite",
        "pulse-glow":  "pulse-glow 2.2s ease-out infinite",
        "pulse-green": "pulse-green 2.4s ease-out infinite",
        "fade-up":     "fade-up 0.4s ease-out both",
        shimmer:       "shimmer 4s linear infinite",
        "spin-slow":   "spin-slow 18s linear infinite",
      },
    },
  },
  plugins: [],
};
