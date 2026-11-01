/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f5f0',
          100: '#d8ebd8',
          200: '#b2d6b2',
          300: '#7db87d',
          400: '#5a9a5a',
          500: '#3d7a3d',
          600: '#336633',
          700: '#2b5530',
          800: '#1e3d20',
          900: '#142b16',
        },
        brand: '#d9573b',
        'brand-dark': '#a63d26',
        'brand-light': '#ec8b6f',
        warm: '#f5f0eb',
        'warm-dark': '#ede8e3',
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
