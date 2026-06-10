/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eefbf3',
          100: '#d6f5e3',
          200: '#b0eacb',
          300: '#7dd9ab',
          400: '#47c085',
          500: '#23a567',  // primary green
          600: '#178452',
          700: '#146844',
          800: '#135337',
          900: '#11452f',
          950: '#07271b',
        },
        surface: '#0f1117',
        card:    '#161b22',
        border:  '#21262d',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
