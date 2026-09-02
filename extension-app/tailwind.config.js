/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./sidepanel.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        baseBlue: {
          DEFAULT: '#0052FF',
          hover: '#0045D8',
          light: 'rgba(0, 82, 255, 0.12)',
        },
        obsidian: {
          base: '#08090D',
          surface: '#10121A',
          card: '#151822',
          border: 'rgba(255, 255, 255, 0.08)',
        }
      },
      fontFamily: {
        heading: ['Outfit', 'sans-serif'],
        body: ['Plus Jakarta Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        "haptix-dark": {
          "primary": "#0052FF",
          "primary-content": "#FFFFFF",
          "secondary": "#38BDF8",
          "accent": "#10B981",
          "neutral": "#151822",
          "base-100": "#08090D",
          "base-200": "#10121A",
          "base-300": "#151822",
          "base-content": "#F1F5F9",
          "info": "#38BDF8",
          "success": "#10B981",
          "warning": "#F59E0B",
          "error": "#F43F5E",
        },
        "haptix-light": {
          "primary": "#0052FF",
          "primary-content": "#FFFFFF",
          "secondary": "#0284C7",
          "accent": "#059669",
          "neutral": "#E2E8F0",
          "base-100": "#F8FAFC",
          "base-200": "#FFFFFF",
          "base-300": "#F1F5F9",
          "base-content": "#0F172A",
          "info": "#0284C7",
          "success": "#059669",
          "warning": "#D97706",
          "error": "#E11D48",
        },
      },
    ],
    darkTheme: "haptix-dark",
    base: true,
    styled: true,
    utils: true,
  },
};
