/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(240 6% 90%)',
        bg: 'hsl(0 0% 100%)',
        panel: 'hsl(240 10% 98%)',
        muted: 'hsl(240 4% 46%)',
        fg: 'hsl(240 10% 10%)',
        accent: 'hsl(217 91% 55%)',
        success: 'hsl(142 71% 38%)',
        danger: 'hsl(0 72% 48%)',
        warning: 'hsl(32 95% 42%)',
      },
      keyframes: {
        'iris-progress': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'iris-progress': 'iris-progress 500ms linear forwards',
      },
    },
  },
  plugins: [],
};
