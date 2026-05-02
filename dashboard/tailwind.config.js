/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        honey: {
          50:  "#fffaeb",
          400: "#facc15",
          500: "#eab308",
          600: "#ca8a04",
          800: "#854d0e",
        },
      },
    },
  },
  plugins: [],
};
