import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'cc-bg': '#EFF0F8',
        'cc-card': '#FFFFFF',
        'cc-border': '#E4E6F0',
        'cc-primary': '#5B5BD6',
        'cc-primary-hover': '#4A4AC8',
        'cc-text': '#1C2048',
        'cc-text-muted': '#9097B4',
        'cc-text-subtle': '#C4C9E0',
        'cc-navy': '#1E1B4B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
}

export default config
