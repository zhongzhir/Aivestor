import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#fbfaf7",
        surface: "#f4f1ea",
        ink: {
          DEFAULT: "#37352f",
          soft: "#6f6a61",
          faint: "#9d9588",
        },
        line: "#e5ded2",
        accent: {
          DEFAULT: "#2f6f4f",
          soft: "#edf4ef",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "var(--font-noto)",
          "PingFang SC",
          "Hiragino Sans GB",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      maxWidth: {
        doc: "760px",
      },
    },
  },
  plugins: [],
};

export default config;
