/**
 * Tailwind, built at compile time.
 *
 * This theme used to live in a <script> block in index.html, alongside
 * `<script src="https://cdn.tailwindcss.com">`. That CDN build is explicitly
 * not for production, and it meant every page load fetched and ran a
 * third-party script on the origin that holds the session token in
 * localStorage — so a compromise of that CDN was a compromise of every live
 * session, on both this app and the CRM (they share a JWT secret).
 *
 * Keep this in sync with `ss crm/tailwind.config.js`: the two apps are forks
 * and are meant to look identical.
 */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
    './context/**/*.{js,ts,jsx,tsx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
      colors: {
        teal: {
          700: '#21615D', // Approximate deep teal from image
          800: '#1A4D4A',
          900: '#123836',
        },
        brand: {
          yellow: '#F4A936',
          teal: '#21615D',
        },
      },
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
