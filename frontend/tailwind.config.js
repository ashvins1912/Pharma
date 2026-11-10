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
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          ink: "var(--qm-ink, #0f172a)",
          text: "var(--qm-text, #334155)",
          muted: "var(--qm-muted, #64748b)",
          canvas: "var(--qm-canvas, #f5f7fb)",
          surface: "var(--qm-surface, #ffffff)",
          "surface-muted": "var(--qm-surface-muted, #f8fafc)",
          border: "var(--qm-border, #e2e8f0)",
          "border-strong": "var(--qm-border-strong, #cbd5e1)",
          success: "var(--qm-success, #047857)",
          warning: "var(--qm-warning, #b45309)",
          danger: "var(--qm-danger, #be123c)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      maxWidth: {
        app: "1920px",
        content: "1760px",
        reading: "48rem",
        form: "60rem",
      },
      borderRadius: {
        surface: "1.125rem",
        "surface-lg": "1.5rem",
      },
      boxShadow: {
        surface: "0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px rgb(15 23 42 / 0.035)",
        raised: "0 12px 32px rgb(15 23 42 / 0.09)",
        focus: "0 0 0 3px rgb(37 99 235 / 0.22)",
      },
      spacing: {
        "safe-bottom": "env(safe-area-inset-bottom)",
        "safe-top": "env(safe-area-inset-top)",
      },
      transitionDuration: {
        fast: "140ms",
        smooth: "200ms",
      },
    },
  },
  plugins: [],
};
