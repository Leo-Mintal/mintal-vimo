/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        ink: '#f8f4ed',
        cocoa: '#d8c8b8',
        white: '#302a3d',
        leaf: '#7ee0a0',
        mint: '#14342a',
        paper: '#111018',
        cream: '#1a1824',
        line: '#4a4152',
        peach: '#b85d70',
        'peach-soft': '#3a202d',
        berry: '#ff85a1',
        'berry-soft': '#3b1728',
        sky: '#8bd8ff',
        'sky-soft': '#123040',
        butter: '#70521f',
        lilac: '#c8b6ff',
        'lilac-soft': '#292242',
      },
      boxShadow: {
        soft: '0 24px 70px rgba(0, 0, 0, 0.36)',
        float: '0 18px 44px rgba(0, 0, 0, 0.34)',
        pop: '0 10px 28px rgba(255, 133, 161, 0.18)',
      },
    },
  },
  plugins: [],
};
