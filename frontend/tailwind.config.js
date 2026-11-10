/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: {
    relative: true,
    files: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
  },
  theme: {
    screens: {
      xs: "360px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
      "3xl": "1920px",
    },
    extend: {
      colors: {
        pharma: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a8a",
          ink: "#0f172a",
          canvas: "#f5f7fb",
          border: "#e2e8f0",
        },
      },
      maxWidth: {
        app: "1920px",
        content: "1760px",
      },
      borderRadius: {
        "surface": "1.125rem",
        "surface-lg": "1.5rem",
      },
      boxShadow: {
        "surface": "0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px rgb(15 23 42 / 0.035)",
        "raised": "0 12px 32px rgb(15 23 42 / 0.09)",
      },
      spacing: {
        "safe-bottom": "env(safe-area-inset-bottom)",
      },
    },
  },
  plugins: [],
}
