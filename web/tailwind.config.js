/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // D365 F&SCM ships Segoe UI; the fallbacks keep it sane off-Windows.
        sans: ['"Segoe UI"', '"Segoe UI Web (West European)"', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        // bluestem brand headings (bundled via @fontsource, no CDN).
        display: ['Poppins', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', '"Courier New"', 'monospace'],
      },
      colors: {
        // bluestem palette (BRAND_GUIDE.md, colours borrowed from rsmus.com)
        // mapped onto the Fluent / D365 F&O token names the components use.
        midnight: '#00153D',
        rsmblue: '#009CDE',
        rsmgreen: '#3F9C35',
        midgrey: '#888B8D',
        nav: {
          DEFAULT: '#00153D',
          hover: '#0B2454',
          text: '#FFFFFF',
        },
        // RSM Blue is too light for white button text and small links (about
        // 3:1), so actions use a deeper shade of it that passes AA; the pure
        // RSM Blue stays on accents, focus underlines and chart series 1.
        brand: {
          DEFAULT: '#0079AD',
          hover: '#00648F',
          pressed: '#00153D',
          tint: '#E5F5FC',
          border: '#009CDE',
        },
        canvas: '#F7F8F9',
        surface: '#FFFFFF',
        stroke: {
          DEFAULT: '#E1E3E5',
          strong: '#888B8D',
          subtle: '#ECEEEF',
        },
        ink: {
          DEFAULT: '#1D2433',
          secondary: '#5F6366',
          disabled: '#A3A6A8',
        },
        // Green / Harvest Amber / Signal Red, each deepened just enough to be
        // legible as small text on white.
        status: {
          good: '#34842B',
          warn: '#A87600',
          bad: '#D0342C',
          goodBg: '#EEF6ED',
          warnBg: '#FEF6E0',
          badBg: '#FBEDEC',
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
