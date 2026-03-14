/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'IBM Plex Sans'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
        display: ["'Crimson Pro'", "serif"],
      },
      colors: {
        ink:    { DEFAULT: "#1a1a2e", light: "#2d2d44" },
        paper:  { DEFAULT: "#faf9f6", warm: "#f4f1eb", border: "#e8e4dc" },
        accent: { DEFAULT: "#2563eb", light: "#eff6ff", hover: "#1d4ed8" },
        gap:    { open: "#dc2626", partial: "#d97706", solved: "#16a34a" },
        node:   { seed: "#1e3a5f", similar: "#2563eb", gap: "#7c3aed" },
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        panel: "0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)",
        float: "0 10px 25px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)",
      }
    }
  },
  plugins: []
}
