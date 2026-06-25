/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sentinel design tokens (see PLAN.md). No gradients, sharp 4px corners.
        sentinel: {
          bg: '#0D1117',
          panel: '#111827',
          hover: '#1C2E45',
          border: '#1E2A3A',
          primary: '#3178C6', // ND blue
          active: '#00FF88', // neon green: active/online ONLY
          text: '#FFFFFF',
          muted: '#A0ADB8',
          alert: '#FF4444',
          caution: '#FFA500',
        },
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        none: '0',
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',
        lg: '4px',
      },
    },
  },
  plugins: [],
}
