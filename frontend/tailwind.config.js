// tailwind.config.js (or tailwind.config.ts)
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Font families ──────────────────────────────────────────
      fontFamily: {
        sans:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', '-apple-system', 'sans-serif'],
      },

      // ── Brand green palette ────────────────────────────────────
      colors: {
        brand: {
          300: '#6ee7a8',
          400: '#4ade80',
          500: '#23a567',  // primary action colour
          600: '#1db368',
          700: '#166f47',
          800: '#0f4f35',
          900: '#083322',
        },
        surface: '#0a0d14',
        card:    'rgba(255,255,255,0.035)',
        border:  'rgba(255,255,255,0.07)',
      },

      // ── Border radius ──────────────────────────────────────────
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },

      // ── Box shadows ────────────────────────────────────────────
      boxShadow: {
        'brand-sm':  '0 4px 16px rgba(35,165,103,0.20)',
        'brand-md':  '0 8px 32px rgba(35,165,103,0.30)',
        'glow':      '0 0 60px rgba(35,165,103,0.12)',
      },

      // ── Backdrop blur ──────────────────────────────────────────
      backdropBlur: {
        xs: '4px',
      },

      // ── Animation / keyframes ──────────────────────────────────
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-600px 0' },
          '100%': { backgroundPosition: '600px 0' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.45s ease both',
        'shimmer':  'shimmer 1.6s infinite ease-in-out',
      },
    },
  },
  plugins: [],
}