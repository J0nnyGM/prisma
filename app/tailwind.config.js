/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        indigo: {
          50: '#fdf3e7',
          100: '#fbe2c3',
          200: '#f7c58c',
          300: '#f3a24e',
          400: '#f0861e',
          500: '#de7518', // Naranja base logo Prisma
          600: '#c55f12', // Color de hover/interacción
          700: '#a34c0e',
          800: '#823c0c',
          900: '#67300a',
          950: '#381603'
        }
      }
    },
  },
  plugins: [],
}
