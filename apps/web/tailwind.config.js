/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2E75B6',
        dark: '#15304e',
        line: '#e2e8f0',
        bg: '#f4f7fb',
        muted: '#64748b',
        green: { DEFAULT: '#2f7d3a', 100: '#dcfce7' },
        red: { DEFAULT: '#c0392b', 100: '#fee2e2' },
        amber: { DEFAULT: '#c07a11', 50: '#fffbeb' },
      },
      fontFamily: {
        sans: ['Malgun Gothic', 'Noto Sans KR', 'Segoe UI', 'sans-serif'],
      },
      spacing: {
        '4.5': '1.125rem',
      },
    },
  },
  plugins: [],
};
