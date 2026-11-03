import { defineConfig, presetWind3 } from 'unocss'

const light = {
  text: '#6b6375',
  heading: '#08060d',
  surface: '#fff',
  border: '#e5e4e7',
  code: '#f4f3ec',
  accent: '#aa3bff',
  'accent-soft': 'rgba(170, 59, 255, 0.1)',
  'accent-border': 'rgba(170, 59, 255, 0.5)',
  muted: 'rgba(244, 243, 236, 0.5)',
  shadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
}

const dark: typeof light = {
  text: '#9ca3af',
  heading: '#f3f4f6',
  surface: '#16171d',
  border: '#2e303a',
  code: '#1f2028',
  accent: '#c084fc',
  'accent-soft': 'rgba(192, 132, 252, 0.15)',
  'accent-border': 'rgba(192, 132, 252, 0.5)',
  muted: 'rgba(47, 48, 58, 0.5)',
  shadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.25)',
}

function variables(tokens: typeof light) {
  return Object.entries(tokens).map(([name, value]) => `--${name}: ${value};`).join('\n')
}

export default defineConfig({
  presets: [presetWind3()],
  // Variant definitions live in .ts files, outside Vite's usual JSX extraction.
  content: {
    pipeline: {
      include: [/\.(tsx?|html)(\?.*)?$/],
    },
  },
  theme: {
    colors: {
      text: 'var(--text)',
      heading: 'var(--heading)',
      surface: 'var(--surface)',
      border: 'var(--border)',
      code: 'var(--code)',
      accent: 'var(--accent)',
      'accent-soft': 'var(--accent-soft)',
      'accent-border': 'var(--accent-border)',
      muted: 'var(--muted)',
      inset: 'color-mix(in srgb, var(--surface) 88%, var(--muted))',
      qr: 'color-mix(in srgb, var(--accent-soft) 45%, var(--surface))',
      'qr-border': 'color-mix(in srgb, var(--accent-border) 65%, var(--border))',
      'qr-marker': 'color-mix(in srgb, var(--accent) 60%, var(--border))',
    },
    fontFamily: {
      sans: "system-ui, 'Segoe UI', Roboto, sans-serif",
      mono: 'ui-monospace, Consolas, monospace',
    },
    boxShadow: {
      card: 'var(--shadow)',
      qr: '0 12px 30px rgba(15, 23, 42, 0.08)',
    },
  },
  // Only document defaults and theme variables belong in the global preflight.
  preflights: [{
    getCSS: () => `
      :root {
        ${variables(light)}
        font: 18px/145% system-ui, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.18px;
        color-scheme: light dark;
        color: var(--text);
        background: var(--surface);
        font-synthesis: none;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      @media (max-width: 1024px) { :root { font-size: 16px; } }
      @media (prefers-color-scheme: dark) { :root { ${variables(dark)} } }
      body, p { margin: 0; }
    `,
  }],
})
