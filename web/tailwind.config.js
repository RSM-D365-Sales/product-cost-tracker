/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // D365 F&SCM ships Segoe UI; the fallbacks keep it sane off-Windows.
        sans: ['"Segoe UI"', '"Segoe UI Web (West European)"', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', '"Courier New"', 'monospace'],
      },
      colors: {
        // Fluent / D365 F&O palette tokens.
        nav: {
          DEFAULT: '#152B3C',
          hover: '#22405A',
          text: '#FFFFFF',
        },
        brand: {
          DEFAULT: '#0F6CBD',
          hover: '#115EA3',
          pressed: '#0C3B5E',
          tint: '#EFF6FC',
          border: '#0F6CBD',
        },
        canvas: '#FAF9F8',
        surface: '#FFFFFF',
        stroke: {
          DEFAULT: '#E1DFDD',
          strong: '#8A8886',
          subtle: '#EDEBE9',
        },
        ink: {
          DEFAULT: '#242424',
          secondary: '#605E5C',
          disabled: '#A19F9D',
        },
        status: {
          good: '#107C10',
          warn: '#C19C00',
          bad: '#A4262C',
          goodBg: '#F1FAF1',
          warnBg: '#FFF9E6',
          badBg: '#FDF3F4',
        },
      },
      fontSize: {
        // F&O runs a tighter type scale than Tailwind's default.
        '2xs': ['10px', '14px'],
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
        base: ['13px', '20px'],
        md: ['14px', '20px'],
        lg: ['16px', '22px'],
        xl: ['20px', '28px'],
        '2xl': ['24px', '32px'],
      },
      boxShadow: {
        flyout: '0 6.4px 14.4px rgba(0,0,0,.13), 0 1.2px 3.6px rgba(0,0,0,.11)',
        card: '0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11)',
      },
    },
  },
  plugins: [],
}
